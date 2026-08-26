import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { systemPermission } from "#/features/access/system-rbac";
import {
	couponEnabledSchema,
	couponIdSchema,
	couponInputSchema,
	couponListSchema,
} from "#/features/coupons/schema";
import { DomainError } from "#/lib/domain-error";
import { createAuditStatement } from "#/server/audit";
import { getAdminServerContext } from "#/server/context";

type CouponRow = {
	id: string;
	code: string;
	name: string;
	type: "fixed" | "percentage";
	currency: string | null;
	currency_decimals: number | null;
	value_minor: string | null;
	value_bps: number | null;
	minimum_order_minor: string | null;
	maximum_discount_minor: string | null;
	usage_limit: number | null;
	usage_limit_per_customer: number | null;
	used_count: number;
	starts_at: number | null;
	ends_at: number | null;
	enabled: number;
	created_at: number;
	updated_at: number;
	scope_json: string;
};

const scopeIdsSchema = z.array(z.uuid());
const scopeTagNamesSchema = z.array(z.string().trim().min(1).max(50));

export const listCouponsFn = createServerFn({ method: "GET" })
	.validator((input: z.input<typeof couponListSchema>) =>
		couponListSchema.parse(input),
	)
	.handler(async ({ data }) => {
		const { db } = await getAdminServerContext(
			systemPermission("coupons", "read"),
		);
		const search = data.search ? `%${data.search}%` : null;
		const where = search ? "WHERE c.code LIKE ? OR c.name LIKE ?" : "";
		const bindings = search ? [search, search] : [];
		const [count, rows] = await db.$client.batch([
			db.$client
				.prepare(`SELECT COUNT(*) AS total FROM coupons c ${where}`)
				.bind(...bindings),
			db.$client
				.prepare(
					`SELECT c.* FROM coupons c ${where}
					 ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`,
				)
				.bind(...bindings, data.pageSize, data.pageIndex * data.pageSize),
		]);
		return {
			data: ((rows?.results ?? []) as CouponRow[]).map(presentCoupon),
			total: Number(
				(count?.results[0] as { total?: unknown } | undefined)?.total ?? 0,
			),
		};
	});

export const saveCouponFn = createServerFn({ method: "POST" })
	.validator((input: z.input<typeof couponInputSchema>) =>
		couponInputSchema.parse(input),
	)
	.handler(async ({ data }) => {
		const { currentUser, db, request } = await getAdminServerContext(
			systemPermission("coupons", data.id ? "update" : "create"),
		);
		const before = data.id
			? await db.$client
					.prepare("SELECT * FROM coupons WHERE id = ? LIMIT 1")
					.bind(data.id)
					.first<Record<string, unknown>>()
			: null;
		if (data.id && !before)
			throw new DomainError("coupon_not_found", 404, "Coupon not found");
		const conflict = await db.$client
			.prepare(
				"SELECT id FROM coupons WHERE code = ? AND (? IS NULL OR id <> ?) LIMIT 1",
			)
			.bind(data.code, data.id ?? null, data.id ?? null)
			.first();
		if (conflict)
			throw new DomainError(
				"coupon_code_conflict",
				409,
				"Coupon code already exists",
			);
		await assertProductIds(db.$client, data.productIds);
		await assertTagNames(db.$client, data.tagNames);
		const scopeJson = JSON.stringify({
			productIds: [...new Set(data.productIds)].sort(),
			tagNames: [...new Set(data.tagNames)].sort(),
		});
		const id = data.id ?? crypto.randomUUID();
		const now = Date.now();
		const values = [
			data.code,
			data.name,
			data.type,
			data.currency ?? null,
			data.currencyDecimals ?? null,
			data.valueMinor ?? null,
			data.valueBps ?? null,
			data.minimumOrderMinor ?? null,
			data.maximumDiscountMinor ?? null,
			data.usageLimit ?? null,
			data.usageLimitPerCustomer ?? null,
			scopeJson,
			data.startsAt ?? null,
			data.endsAt ?? null,
			data.enabled,
		] as const;
		const mutation = data.id
			? db.$client
					.prepare(
						`UPDATE coupons SET code = ?, name = ?, type = ?, currency = ?, currency_decimals = ?, value_minor = ?,
						 value_bps = ?, minimum_order_minor = ?, maximum_discount_minor = ?,
						 usage_limit = ?, usage_limit_per_customer = ?, scope_json = ?, starts_at = ?, ends_at = ?,
						 enabled = ?, updated_at = ? WHERE id = ?`,
					)
					.bind(...values, now, id)
			: db.$client
					.prepare(
						`INSERT INTO coupons
						 (id, code, name, type, currency, currency_decimals, value_minor, value_bps, minimum_order_minor,
						  maximum_discount_minor, usage_limit, usage_limit_per_customer, scope_json, starts_at,
						  ends_at, enabled, used_count, created_at, updated_at)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
					)
					.bind(id, ...values, now, now);
		await db.$client.batch([
			mutation,
			createAuditStatement(db.$client, request, currentUser.id, {
				action: data.id ? "coupon.updated" : "coupon.created",
				targetType: "coupon",
				targetId: id,
				before,
				after: {
					...data,
					productIds: data.productIds,
					tagNames: data.tagNames,
				},
			}),
		]);
		return { id };
	});

export const setCouponEnabledFn = createServerFn({ method: "POST" })
	.validator((input: z.input<typeof couponEnabledSchema>) =>
		couponEnabledSchema.parse(input),
	)
	.handler(async ({ data }) => {
		const { currentUser, db, request } = await getAdminServerContext(
			systemPermission("coupons", "update"),
		);
		const before = await db.$client
			.prepare("SELECT id, enabled FROM coupons WHERE id = ? LIMIT 1")
			.bind(data.id)
			.first<Record<string, unknown>>();
		if (!before)
			throw new DomainError("coupon_not_found", 404, "Coupon not found");
		await db.$client.batch([
			db.$client
				.prepare("UPDATE coupons SET enabled = ?, updated_at = ? WHERE id = ?")
				.bind(data.enabled, Date.now(), data.id),
			createAuditStatement(db.$client, request, currentUser.id, {
				action: "coupon.enabled_changed",
				targetType: "coupon",
				targetId: data.id,
				before,
				after: { enabled: data.enabled },
			}),
		]);
		return data;
	});

export const deleteCouponFn = createServerFn({ method: "POST" })
	.validator((input: z.input<typeof couponIdSchema>) =>
		couponIdSchema.parse(input),
	)
	.handler(async ({ data }) => {
		const { currentUser, db, request } = await getAdminServerContext(
			systemPermission("coupons", "delete"),
		);
		const before = await db.$client
			.prepare(
				`SELECT c.*, (SELECT COUNT(*) FROM coupon_redemptions cr
				 WHERE cr.coupon_id = c.id) AS redemption_count
				 FROM coupons c WHERE c.id = ? LIMIT 1`,
			)
			.bind(data.id)
			.first<Record<string, unknown>>();
		if (!before)
			throw new DomainError("coupon_not_found", 404, "Coupon not found");
		if (Number(before.redemption_count) > 0)
			throw new DomainError(
				"coupon_in_use",
				409,
				"Used coupons cannot be deleted",
			);
		await db.$client.batch([
			db.$client.prepare("DELETE FROM coupons WHERE id = ?").bind(data.id),
			createAuditStatement(db.$client, request, currentUser.id, {
				action: "coupon.deleted",
				targetType: "coupon",
				targetId: data.id,
				before,
			}),
		]);
		return { id: data.id };
	});

async function assertProductIds(db: D1Database, ids: string[]) {
	if (ids.length === 0) return;
	const result = await db
		.prepare(
			`SELECT id FROM products WHERE id IN (${ids.map(() => "?").join(",")})`,
		)
		.bind(...ids)
		.all();
	if (result.results.length !== ids.length)
		throw new DomainError(
			"coupon_scope_invalid",
			400,
			"Coupon scope contains an unknown record",
		);
}

async function assertTagNames(db: D1Database, names: string[]) {
	if (names.length === 0) return;
	const result = await db
		.prepare(
			`SELECT DISTINCT tag.value AS name
			 FROM products product, json_each(product.tag_names) tag
			 WHERE tag.value IN (${names.map(() => "?").join(",")})`,
		)
		.bind(...names)
		.all();
	if (result.results.length !== names.length)
		throw new DomainError(
			"coupon_scope_invalid",
			400,
			"Coupon scope contains an unknown tag",
		);
}

function presentCoupon(row: CouponRow) {
	const scope = scopeIdsSchema
		.or(
			z.object({
				productIds: scopeIdsSchema,
				tagNames: scopeTagNamesSchema,
			}),
		)
		.safeParse(JSON.parse(row.scope_json));
	const scopeValue =
		scope.success && !Array.isArray(scope.data)
			? scope.data
			: { productIds: [], tagNames: [] };
	return {
		id: row.id,
		code: row.code,
		name: row.name,
		type: row.type,
		currency: row.currency,
		currencyDecimals: row.currency_decimals,
		valueMinor: row.value_minor,
		valueBps: row.value_bps,
		minimumOrderMinor: row.minimum_order_minor,
		maximumDiscountMinor: row.maximum_discount_minor,
		usageLimit: row.usage_limit,
		usageLimitPerCustomer: row.usage_limit_per_customer,
		usedCount: row.used_count,
		startsAt: row.starts_at,
		endsAt: row.ends_at,
		enabled: Boolean(row.enabled),
		productIds: scopeValue.productIds,
		tagNames: scopeValue.tagNames,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}
