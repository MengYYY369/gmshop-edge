import { z } from "zod";
import { DomainError } from "#/lib/domain-error";
import { decimalToMinor } from "../money";
import type { SupplierPurchaseResult } from "../schema";
import { supplierFetchJson } from "./http";
import { signDujiaoNextRequest } from "./signatures";
import type { SupplierAdapter, SupplierProduct, SupplierSku } from "./types";

const productSchema = z.object({
	id: z.number().int().positive(),
	title: z.record(z.string(), z.string()).default({}),
	description: z.record(z.string(), z.string()).default({}),
	images: z.array(z.string().max(2048)).max(20).default([]),
	tags: z.array(z.string().max(512)).max(100).default([]),
	category_id: z.number().int().nonnegative().default(0),
	is_active: z.boolean(),
	updated_at: z.iso.datetime({ offset: true }).nullable().optional(),
	skus: z
		.array(
			z.object({
				id: z.number().int().positive(),
				sku_code: z.string(),
				spec_values: z.record(z.string(), z.unknown()).default({}),
				price_amount: z.string(),
				member_price: z.string().optional(),
				stock_quantity: z.number().int(),
				is_active: z.boolean(),
			}),
		)
		.max(10_000),
});

export class DujiaoNextAdapter implements SupplierAdapter {
	private categoriesPromise?: Promise<Map<number, string>>;

	constructor(
		private readonly input: {
			baseUrl: string;
			apiKey: string;
			apiSecret: string;
			currency: string;
			currencyDecimals: number;
			fetcher?: typeof fetch;
			now?: () => number;
		},
	) {}

	async testConnection() {
		const body = await this.request("POST", "/api/v1/upstream/ping");
		const parsed = z
			.object({
				ok: z.literal(true),
				site_name: z.string(),
				balance: z.string(),
				currency: z.string(),
			})
			.parse(body);
		this.assertCurrency(parsed.currency);
		return {
			siteName: parsed.site_name,
			balance: {
				amountMinor: decimalToMinor(
					parsed.balance,
					this.input.currencyDecimals,
				),
				currency: parsed.currency,
			},
		};
	}

	async listProducts(input: {
		page: number;
		pageSize: number;
		updatedAfter?: string;
		includeInactive?: boolean;
	}) {
		const query = new URLSearchParams({
			page: String(input.page),
			page_size: String(Math.min(input.pageSize, 50)),
		});
		if (input.updatedAfter) query.set("updated_after", input.updatedAfter);
		if (input.includeInactive) query.set("include_inactive", "true");
		const [body, categories] = await Promise.all([
			this.request("GET", `/api/v1/upstream/products?${query}`),
			this.categories(),
		]);
		const parsed = z
			.object({
				total: z.number().int().nonnegative(),
				items: z.array(productSchema),
			})
			.parse(body);
		return {
			total: parsed.total,
			products: parsed.items.map((product) =>
				this.product(product, categories),
			),
		};
	}

	async getSku(productId: string, skuId: string) {
		const body = await this.request(
			"GET",
			`/api/v1/upstream/products/${encodeURIComponent(productId)}`,
		);
		const parsed = z
			.object({ ok: z.boolean(), product: productSchema })
			.parse(body);
		const sku = this.product(parsed.product, await this.categories()).skus.find(
			(item) => item.id === skuId,
		);
		if (!sku) throw notFound();
		return sku;
	}

	async submitOrder(input: {
		skuId: string;
		quantity: number;
		requestNo: string;
		callbackUrl: string;
		traceId: string;
	}): Promise<SupplierPurchaseResult> {
		const body = await this.request("POST", "/api/v1/upstream/orders", {
			sku_id: Number(input.skuId),
			quantity: input.quantity,
			downstream_order_no: input.requestNo,
			trace_id: input.traceId,
			callback_url: input.callbackUrl,
		});
		const parsed = z
			.object({
				ok: z.boolean(),
				order_id: z.number().int().positive().optional(),
				status: z.string().optional(),
				currency: z.string().optional(),
				error_code: z.string().optional(),
			})
			.parse(body);
		if (parsed.currency) this.assertCurrency(parsed.currency);
		if (!parsed.ok || !parsed.order_id) {
			return {
				status: "definitively_failed",
				errorCode: parsed.error_code ?? "supplier_order_rejected",
			};
		}
		return {
			status: "processing",
			upstreamOrderId: String(parsed.order_id),
		};
	}

	async reconcileOrder(input: {
		upstreamOrderId: string | null;
	}): Promise<SupplierPurchaseResult> {
		if (!input.upstreamOrderId) {
			return {
				status: "uncertain",
				upstreamOrderId: null,
				errorCode: "supplier_order_id_missing",
			};
		}
		const body = await this.request(
			"GET",
			`/api/v1/upstream/orders/${encodeURIComponent(input.upstreamOrderId)}`,
		);
		const parsed = z
			.object({
				order_id: z.number().int().positive(),
				status: z.string(),
				fulfillment: z
					.object({
						status: z.string(),
						payload: z.string().default(""),
					})
					.nullable()
					.optional(),
			})
			.parse(body);
		if (parsed.fulfillment?.status === "delivered") {
			const cards = parsed.fulfillment.payload
				.split(/\r?\n/)
				.map((value) => value.trim())
				.filter(Boolean);
			if (cards.length > 10_000 || cards.some((card) => card.length > 64_000))
				throw providerError(null);
			return cards.length
				? {
						status: "supplied",
						upstreamOrderId: String(parsed.order_id),
						cards,
					}
				: {
						status: "uncertain",
						upstreamOrderId: String(parsed.order_id),
						errorCode: "supplier_delivery_empty",
					};
		}
		if (["cancelled", "failed", "refunded"].includes(parsed.status)) {
			return {
				status: "definitively_failed",
				errorCode: `supplier_order_${parsed.status}`,
			};
		}
		return { status: "processing", upstreamOrderId: String(parsed.order_id) };
	}

	async cancelOrder(upstreamOrderId: string) {
		const body = await this.request(
			"POST",
			`/api/v1/upstream/orders/${encodeURIComponent(upstreamOrderId)}/cancel`,
		);
		return z
			.object({
				ok: z.literal(true),
				order_id: z.number().int().positive(),
				status: z.string(),
			})
			.parse(body);
	}

	private product(
		value: z.infer<typeof productSchema>,
		categories: Map<number, string>,
	): SupplierProduct {
		return {
			id: String(value.id),
			name: localized(value.title),
			description: localized(value.description),
			imageUrls: value.images,
			categoryNames: [
				...(categories.get(value.category_id)
					? [categories.get(value.category_id) ?? ""]
					: []),
				...value.tags,
			],
			active: value.is_active,
			...(value.updated_at ? { updatedAt: value.updated_at } : {}),
			skus: value.skus.map(
				(sku): SupplierSku => ({
					id: String(sku.id),
					name: sku.sku_code || JSON.stringify(sku.spec_values),
					costMinor: decimalToMinor(
						sku.member_price ?? sku.price_amount,
						this.input.currencyDecimals,
					),
					stockQuantity:
						sku.stock_quantity < 0 ? 2_147_483_647 : sku.stock_quantity,
					active: sku.is_active,
				}),
			),
		};
	}

	private categories() {
		this.categoriesPromise ??= this.request(
			"GET",
			"/api/v1/upstream/categories",
		).then((body) => {
			const parsed = z
				.object({
					ok: z.literal(true),
					categories: z.array(
						z.object({
							id: z.number().int().positive(),
							name: z.record(z.string(), z.string()).default({}),
						}),
					),
				})
				.parse(body);
			return new Map(
				parsed.categories.map((category) => [
					category.id,
					localized(category.name),
				]),
			);
		});
		return this.categoriesPromise;
	}

	private async request(method: string, path: string, value?: unknown) {
		const rawBody = value === undefined ? "" : JSON.stringify(value);
		const signPath = path.split("?")[0] ?? path;
		const timestamp = String(
			Math.floor((this.input.now?.() ?? Date.now()) / 1000),
		);
		const { status, body } = await supplierFetchJson(
			this.input.fetcher ?? fetch,
			`${this.input.baseUrl}${path}`,
			{
				method,
				headers: {
					"Dujiao-Next-Api-Key": this.input.apiKey,
					"Dujiao-Next-Timestamp": timestamp,
					"Dujiao-Next-Signature": signDujiaoNextRequest({
						method,
						path: signPath,
						timestamp,
						rawBody,
						apiSecret: this.input.apiSecret,
					}),
					...(value === undefined
						? {}
						: { "Content-Type": "application/json" }),
				},
				body: value === undefined ? undefined : rawBody,
			},
			{ validateDestination: !this.input.fetcher },
		);
		if (status !== 200) throw providerError(body);
		return body;
	}

	private assertCurrency(value: string) {
		if (value.toUpperCase() !== this.input.currency.toUpperCase()) {
			throw new DomainError(
				"supplier_currency_mismatch",
				502,
				"Supplier currency does not match its account",
			);
		}
	}
}

function localized(value: Record<string, string>) {
	return (
		value["zh-CN"] || value["en-US"] || Object.values(value).find(Boolean) || ""
	);
}

function providerError(body: unknown) {
	const parsed = z
		.object({ error_code: z.string().optional() })
		.safeParse(body);
	return new DomainError(
		parsed.success
			? (parsed.data.error_code ?? "supplier_request_failed")
			: "supplier_request_failed",
		502,
		"Supplier request failed",
	);
}

function notFound() {
	return new DomainError(
		"supplier_sku_not_found",
		404,
		"Supplier SKU was not found",
	);
}
