import { cloudflare } from "@cloudflare/vite-plugin";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// @visulima/email/providers/* 依赖完整的 Node.js 模块（node:fs,
// node:stream 等），会破坏 Cloudflare Workers 部署验证。项目实际使用
// Cloudflare Email Workers (send_email binding) 发送邮件，不会用到
// 这些外部提供商。把它们指向桩文件以排除出 SSR bundle。
const emailProviderAlias = {
	find: /@visulima\/email\/providers\/(mailgun|postmark|resend|sendgrid|smtp)$/,
	replacement: "./src/features/notifications/server/_email-provider-stubs.ts",
};

// paraglideMiddleware 在模块顶层使用了 await import("async_hooks"),
// Cloudflare Workers 的 nodejs_compat 不提供 async_hooks,导致抛异常。
// 在 bundle 最终输出中将其包裹在 try/catch 中，失败时使用 mock 兜底，
// 成功时使用真实 AsyncLocalStorage。原来的 import + 实例化代码被整体替换，
// 避免 import 失败后后面那行 "new AsyncLocalStorage()" 仍被执行导致再次抛错。
function paraglideAsyncHooksPlugin(): Plugin {
	return {
		name: "paraglide-async-hooks-patch",
		renderChunk(code) {
			// Match the two-line pattern: import then instantiation.
			const pattern =
				/const \{ AsyncLocalStorage \} = await import\("async_hooks"\);\s*overwriteServerAsyncLocalStorage\(new AsyncLocalStorage\(\)\);/g;
			if (pattern.test(code)) {
				return code.replace(
					pattern,
					`let AsyncLocalStorage;
try {
	({ AsyncLocalStorage } = await import("async_hooks"));
} catch {
	overwriteServerAsyncLocalStorage(createMockAsyncLocalStorage());
} finally {
	if (AsyncLocalStorage) overwriteServerAsyncLocalStorage(new AsyncLocalStorage());
}`,
				);
			}
			return code;
		},
	};
}

const config = defineConfig({
	resolve: {
		tsconfigPaths: true,
		alias: [emailProviderAlias],
	},
	define: {
		// TanStack Start 在模块顶层使用 process.env.TSS_PRERENDERING 等标识，
		// Cloudflare Workers deploy validation 沙箱中 process 未定义。将其静态
		// 替换为字面量，SSR bundle 中这些标志在生产环境下均为 false。
		"process.env.TSS_PRERENDERING": JSON.stringify("false"),
		"process.env.TSS_SHELL": JSON.stringify("false"),
	},
	plugins: [
		cloudflare({ viteEnvironment: { name: "ssr" } }),
		devtools(),
		paraglideVitePlugin({
			project: "./project.inlang",
			outdir: "./src/paraglide",
			strategy: ["cookie", "custom-system-default", "baseLocale"],
		}),
		tailwindcss(),
		tanstackStart({ start: { entry: "./src/server-entry.ts" } }),
		viteReact(),
		babel({ presets: [reactCompilerPreset()] }),
		paraglideAsyncHooksPlugin(),
	],
});

export default config;
