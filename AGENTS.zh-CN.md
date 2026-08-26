# GMShop Edge 工程契约

[English](AGENTS.md)

## 产品边界

- 产品、包、Worker、Bun 服务、数据库和持久资源名称统一为 `GMShop Edge` /
  `gmshop-edge`。
- GMShop 是单部署、单租户数字商品商城，不是支付网关；支持预置库存、私有下载和
  自动化商品。
- 公开站点和客户中心使用常规 Header，内部运营使用 `/admin` 和权限导航。
- GMShop 可以使用单部署加密凭证接入明确批准的第三方托管支付服务，包括 Cryptomus
  发票；但不得对外提供商户协议、充当支付网关、托管钱包、扫描链上交易、适配交易所/
  钱包收款或创建网关订单。

## 技术栈与归属

- 使用 Bun、严格 TypeScript、React 19、TanStack Start/Router/Query/Table/Form、
  Tailwind CSS 4、shadcn/Radix、Zod、Better Auth、Drizzle、Cloudflare Workers
  （D1/KV/R2/Queues/Cron）、Bun + Nitro + SQLite、Paraglide、Vitest、Biome
  和 Wrangler；Docker 是支持的 Bun 分发方式。
- 不增加第二套路由、认证、ORM、表单、缓存、格式化、检查或 i18n 运行时。
- feature 的页面、schema、Server Function、类型和行为位于 `src/features`；路由保持
  薄层；跨领域运行时位于 `src/server`；Drizzle schema 位于 `src/db/schema`；测试位于
  `tests/{unit,integration,security,e2e,fixtures,helpers}`。
- 保持既有 public/auth/install/dashboard/settings 布局、ProTable/ProForm、侧栏、主题
  和响应式交互。

## 领域不变量

- 商品类型为 `stock | download | automation`。预置库存原子分配加密文本，下载授予
  私有文件，自动化执行部署、脚本、资源开通或具体构建流程。自动化方法使用产出策略
  `none | optional | required`；订单、输入定义、价格、权益和自动化历史使用不可变快照。
- 法币为 `*_minor` 十进制整数字符串，比例为 `*_bps`，时间/时长为毫秒，大小为字节；
  金额绝不使用浮点。
- D1 权威决定订单、优惠券、库存、权益、自动化额度、重放、限流和审计；状态转换与
  outbox 原子且幂等。KV 仅用于已校验、带版本、有时限的读取缓存。
- Workers 与 Bun/Nitro 通过显式运行时适配器承载同一全栈。Bun 使用 SQLite 权威数据、
  进程内有界缓存、本地私有对象、SQLite 可靠 Queue 和一分钟调度器。Bun 仅支持单实例，
  不支持多副本或共享网络存储。
- 私有商品图片、下载、制品和导出使用 R2；客户端不得选择 object key；Queue 只携带
  非秘密引用。
- 预置库存分配必须原子；交付与自动化状态机明确处理重试、重复、过期、取消、退款和人工恢复。

## 认证与安全

- Better Auth 管理用户、凭证、账号、会话、密码和一次性验证；项目 RBAC 在用户上保存
  规范化角色 ID，并在角色上保存模块权限掩码。
- 安装器只创建首个 root 和必要设置；root 不可编辑/删除，最后启用 root 不可禁用或
  移除角色。
- 每个后台服务端入口校验启用会话和结构化权限；前端隐藏不能替代服务端授权。
- 动态邮箱/社交/OIDC/Telegram provider 使用已校验预设和 ID；秘密使用用途隔离、带
  版本信封，配置变更使 revision auth 工厂缓存失效；链接/解绑/停用不得导致账号锁死。
- Telegram Mini App 校验原始 initData HMAC、Bot、时效、来源、规范用户 ID 和 D1
  重放；Telegram OIDC 校验 code+PKCE、issuer、audience、nonce、签名、时间、state
  和重放；grammY Webhook Bot 提供本地化指令、固定 Mini App 目标和 Forum Topic
  客服且不保存消息内容；客服回复只信任新鲜的 Telegram 管理员镜像。
- 执行可信 Host/Origin、CSRF、有界请求体、安全响应头、结构化脱敏错误、SSRF/路径
  防护、D1 限流和审计；敏感导出要求新鲜密码再认证。没有本地密码的管理员必须先设置
  密码，才能执行敏感导出。

## 界面与国际化

- 所有用户文案使用 Paraglide，支持 `en-US` 和 `zh-CN`；商品内容允许在没有契约级
  净化要求的情况下渲染已存储 HTML，并按当前 locale → `en-US` → 基础字段回退。
- 显式本地化金额、日期、数量、状态、计费周期、文件大小和构建单位。
- 必须支持键盘、可访问名称、焦点恢复、减少动态效果、移动端、加载/空/错误状态和深浅主题。


## 质量与交付

- 保持严格类型，在边界用 Zod 一次校验，使用结构化领域错误；非平凡改动后简化 touched
  diff。优先共置和直接控制流，不创建通用 service/repository/barrel 层。
- Biome 是唯一格式化/导入整理器，保留用户无关改动。
- 全新安装唯一迁移为 `drizzle/0000_gmshop.sql`；正常开发不重复生成，也不把网关数据
  伪装成商城数据。
- `bun run build`、`bun run predeploy` 与 `bun run deploy` 仅用于 Workers；Bun 使用
  `bun run build:bun` 和多架构 GHCR 镜像。唯一公开 Bun 环境变量是
  `GMSHOP_DATA_DIR`；Origin、Allowed Hosts、邮件和业务凭据由产品界面配置。
- Bun 备份、恢复及 Cloudflare 迁入必须使用 `bun run data -- …`，禁止覆盖非空目标或
  复制运行中的 SQLite 数据库。
- 真实支付、邮件、Telegram、构建提供商 smoke 测试是手动且无条件跳过资产；环境变量
  不得自动启用。
- 开发中运行专项检查；所有可执行 TODO 完成后，才在同一最终树运行一次：

```bash
bun run typecheck
bun run test
bun run check
bun run build
bun run build:bun
```

- 完成还要求空 D1 迁移、权限路径、查询计划、R2/Queue、双语言/主题/移动/键盘浏览器
  和成对文档证据；禁止提交真实秘密。
- 发布从 `main` 使用 semantic-release。原生 amd64 和 arm64 job 必须先完成 smoke
  test，再发布带 SBOM 与 provenance 的 GHCR manifest。
