import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { systemPermission } from "#/features/access/system-rbac";
import {
	cancelBuildJob,
	retryBuildJob,
} from "#/features/builds/server/job-actions";
import { getAdminServerContext } from "#/server/context";

const listSchema = z.object({
	pageIndex: z.number().int().min(0).default(0),
	pageSize: z.number().int().min(1).max(100).default(10),
	search: z.string().trim().max(200).default(""),
});
const jobSchema = z.object({ id: z.uuid() });

export const listBuildJobsFn = createServerFn({ method: "GET" })
	.validator((input: z.input<typeof listSchema>) => listSchema.parse(input))
	.handler(async ({ data }) => {
		const { db } = await getAdminServerContext(
			systemPermission("automation", "read"),
		);
		const search = data.search ? `%${data.search}%` : null;
		const where = search
			? "WHERE bj.id LIKE ? OR o.order_number LIKE ? OR oi.product_name LIKE ?"
			: "";
		const bindings = search ? [search, search, search] : [];
		const [count, rows] = await db.$client.batch([
			db.$client
				.prepare(
					`SELECT COUNT(*) AS total FROM automation_jobs bj
					 JOIN shop_order_items oi ON oi.id = bj.order_item_id
					 JOIN shop_orders o ON o.id = oi.order_id ${where}`,
				)
				.bind(...bindings),
			db.$client
				.prepare(
					`SELECT bj.id, bj.status, bj.method_key, bj.runtime, bj.attempt_count,
					 bj.timeout_at, bj.started_at, bj.completed_at, bj.run_url,
					 bj.failure_code, bj.created_at, o.order_number, oi.product_name,
					 oi.sellable_item_name, COALESCE(o.contact_email, u.email) AS customer_email,
					 (SELECT COUNT(*) FROM automation_artifacts ba WHERE ba.automation_job_id = bj.id
					  AND ba.deleted_at IS NULL) AS artifact_count
					 FROM automation_jobs bj JOIN shop_order_items oi ON oi.id = bj.order_item_id
					 JOIN shop_orders o ON o.id = oi.order_id
					 LEFT JOIN users u ON u.id = o.user_id
					 JOIN customer_entitlements ce ON ce.id = bj.entitlement_id ${where}
					 ORDER BY bj.created_at DESC, bj.id DESC LIMIT ? OFFSET ?`,
				)
				.bind(...bindings, data.pageSize, data.pageIndex * data.pageSize),
		]);
		return {
			data: resultRows(rows).map(presentJob),
			total: Number(
				(count?.results[0] as { total?: unknown } | undefined)?.total ?? 0,
			),
		};
	});

export const retryBuildJobFn = createServerFn({ method: "POST" })
	.validator((input: z.input<typeof jobSchema>) => jobSchema.parse(input))
	.handler(async ({ data }) => {
		const { currentUser, db, request } = await getAdminServerContext(
			systemPermission("automation", "update"),
		);
		return retryBuildJob(db.$client, data.id, {
			actorUserId: currentUser.id,
			request,
		});
	});

export const cancelBuildJobFn = createServerFn({ method: "POST" })
	.validator((input: z.input<typeof jobSchema>) => jobSchema.parse(input))
	.handler(async ({ data }) => {
		const { currentUser, db, request } = await getAdminServerContext(
			systemPermission("automation", "update"),
		);
		return cancelBuildJob(db.$client, data.id, {
			actorUserId: currentUser.id,
			request,
		});
	});

function resultRows(result: D1Result<unknown> | undefined) {
	return (result?.results ?? []) as Record<string, unknown>[];
}

function presentJob(row: Record<string, unknown>) {
	return {
		id: String(row.id),
		status: String(row.status),
		orderNumber: String(row.order_number),
		productName: String(row.product_name),
		sellableItemName: String(row.sellable_item_name),
		customerEmail: String(row.customer_email),
		methodKey: String(row.method_key),
		runtime: String(row.runtime),
		attemptCount: Number(row.attempt_count),
		artifactCount: Number(row.artifact_count),
		timeoutAt: Number(row.timeout_at),
		startedAt: row.started_at == null ? null : Number(row.started_at),
		completedAt: row.completed_at == null ? null : Number(row.completed_at),
		runUrl: row.run_url == null ? null : String(row.run_url),
		failureCode: row.failure_code == null ? null : String(row.failure_code),
		createdAt: Number(row.created_at),
	};
}
