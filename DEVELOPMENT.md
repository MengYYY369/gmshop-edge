# GMShop Edge - 开发规范

## 项目概述

GMShop Edge 是一个基于 Cloudflare Workers 的电商平台边缘计算服务，使用 TanStack Start (React) 框架构建，包含前后端完整功能。

## 技术栈

| 类别 | 技术 |
|------|------|
| 运行时 | Cloudflare Workers (nodejs_compat) |
| 前端 | React 19 + TanStack Start + TanStack Router |
| 构建工具 | Vite 8 + @cloudflare/vite-plugin |
| 数据库 | Cloudflare D1 (SQLite) + Drizzle ORM |
| 存储 | Cloudflare R2、KV |
| 队列 | Cloudflare Queues |
| 包管理器 | Bun |
| Lint/Format | Biome 2.4.5 |

## 代码风格

- **格式化**: 使用 Tab 缩进，双引号（由 Biome 自动管理）
- **路径别名**: 使用 `#/` 前缀引用 `src/` 下的模块（如 `import { foo } from "#/lib/utils"`）
- **类型**: TypeScript 严格模式，使用 Zod 进行运行时校验
- **样式**: Tailwind CSS 4 + CSS 变量主题

## 目录结构

```
src/
├── features/          # 按业务功能组织的模块
│   ├── auth/          # 认证（Better Auth）
│   ├── shop-payments/ # 支付（PayPal、GMpay、EPay）
│   ├── shop-orders/   # 订单管理
│   ├── storefront/    # 商店前端
│   └── ...
├── routes/            # 路由定义（TanStack Router 文件约定）
│   ├── admin/         # 管理后台路由
│   ├── (public)/      # 公开页面路由
│   └── api/           # API 端点
├── server/            # 服务端逻辑（非路由）
│   ├── scheduled/     # Cron 定时任务
│   ├── middleware/    # 中间件
│   └── queue/         # 队列处理
├── components/shared/ # 共享 UI 组件
├── lib/               # 通用工具库
└── db/schema/         # Drizzle 数据库 schema
```

## Feature 模块结构

每个业务功能模块按以下结构组织：

```
features/<name>/
├── schema.ts          # Zod 校验 schema
├── error-message.ts   # 错误码定义
├── pages/             # 页面组件（仅管理后台）
│   └── xxx.tsx
└── server/            # 服务端逻辑
    ├── admin.ts       # 管理端 server functions
    └── service.ts     # 核心业务逻辑
```

## 开发命令

```bash
# 本地开发
bun run dev

# 类型检查
bun run typecheck

# Lint / 格式化
bun run lint
bun run format

# 本地数据库迁移
bun run db:migrate:local

# 远程数据库迁移
bun run db:migrate:remote

# 构建
bun run build
```

## 部署

- **生产部署**: 推送到 GitHub main 分支，Cloudflare 原生集成自动触发构建
- **构建命令**: `bun run build`
- **部署命令**: `bun run deploy`
- **前置条件**: Cloudflare Build Token 有效（在 Dashboard → Workers → Build 配置）

### Cloudflare 构建配置（GitHub 重连时）

| 字段 | 值 |
|------|-----|
| Build command | `bun run build` |
| Deploy command | `bun run deploy` |
| Root directory | `/` |

## 数据库迁移

1. 修改 `src/db/schema/` 中的 Drizzle schema
2. 生成迁移: `bun run db:generate`
3. 本地验证: `bun run db:migrate:local`
4. 提交迁移文件（`drizzle/` 目录）
5. CI/CD 自动运行远程迁移: `bun run predeploy`（迁移 + vite build）→ `bun run deploy`

## Cron 定时任务

- 入口: `src/server/scheduled/index.ts`
- 通过 `handleScheduled` 函数处理，触发条件在 `wrangler.jsonc` 的 `triggers.crons`
- 当前配置: 每分钟执行 (`* * * * *`)
- 在 `runScheduledCommerceWork` 中添加新的定时任务逻辑

## 支付提供商集成

| Provider | 文件 | 说明 |
|----------|------|------|
| PayPal | `src/features/shop-payments/providers/paypal.ts` | 支持 webhook + 主动查询 |
| GMpay | 外部 Worker | HTTP 调用，注意同 Account Worker 间需 Service Binding |
| EPay | 外部服务 | HTTP 调用 |

### 支付状态即时同步

- 服务端函数: `syncPaymentWithProvider()` (service.ts)
- 前端调用: `syncPaymentStatusFn` (storefront/server/functions.ts)
- 订单页面加载时立即调用，将 PayPal 等 webhook 延迟从 ~10s 降到 <1s

## 国际化 (i18n)

- 使用 ParaglideJS 管理
- 源文件: `messages/en-US.json`、`messages/zh-CN.json`
- 生成代码: `src/paraglide/`

## Git 规范

- 主分支: `main`
- 提交格式: `feat/fix/refactor(scope): 描述`
- 推送即触发 CI/CD，**不要手动 `wrangler deploy`**

## 注意事项

1. **不要手动部署**: 始终通过推送到 GitHub 触发 CI/CD
2. **路径别名**: 统一使用 `#/` 而不是相对路径 `../../`
3. **Biome 配置**: 修改 `biome.json`，不要新增 prettier/eslint 配置
4. **类型安全**: API 返回值必须经过 Zod schema 校验
5. **Cloudflare 限制**: Worker 代码需兼容 nodejs_compat，避免使用 Node.js 专属 API
6. **序列化**: Service Binding 返回值不可直接序列化（seroval 不支持），需在目标 Worker 内部处理
