import { z } from "zod";
import { requireAdmin } from "#/features/access/server/require-admin";
import { systemPermission } from "#/features/access/system-rbac";
import { DomainError } from "#/lib/domain-error";
import { getEnv } from "#/server/db.server";
import { createDownloadAsset } from "./download-assets";

const updateSchema = z.object({
	id: z.uuid(),
	enabled: z.boolean(),
});

export async function listAdminDownloadAssets(request: Request) {
	await requireAdmin(request, systemPermission("products", "read"));
	const db = getEnv().DB;
	const [rows, targets] = await db.batch([
		db.prepare(
			`SELECT da.id, da.product_id,
			 binding.sellable_item_id AS component_id, da.file_name, da.content_type,
			 da.size_bytes, da.checksum_sha256, da.version, da.download_enabled, da.sort_order,
			 da.created_at, p.name AS product_name, sellableItem.name AS sellable_item_name
			 FROM download_assets da JOIN products p ON p.id = da.product_id
			 JOIN download_asset_sellable_items binding
			  ON binding.download_asset_id = da.id
			 JOIN product_sellable_items sellableItem
			  ON sellableItem.id = binding.sellable_item_id
			 ORDER BY da.created_at DESC, da.id DESC LIMIT 100`,
		),
		db.prepare(
			`SELECT p.id AS product_id, p.name AS product_name,
			 sellableItem.id AS component_id,
			 sellableItem.name AS sellable_item_name
			 FROM products p JOIN product_sellable_items sellableItem
			  ON sellableItem.product_id = p.id AND sellableItem.enabled = 1
			 WHERE p.product_type = 'download'
			 ORDER BY p.name, sellableItem.name`,
		),
	]);
	return Response.json({
		data: resultRows(rows).map((row) => ({
			id: String(row.id),
			productId: String(row.product_id),
			productName: String(row.product_name),
			componentId: String(row.component_id),
			sellableItemName: String(row.sellable_item_name),
			fileName: String(row.file_name),
			contentType: String(row.content_type),
			sizeBytes: Number(row.size_bytes),
			checksumSha256: String(row.checksum_sha256),
			version: Number(row.version),
			enabled: Boolean(row.download_enabled),
			createdAt: Number(row.created_at),
		})),
		targets: resultRows(targets).map((row) => ({
			productId: String(row.product_id),
			productName: String(row.product_name),
			componentId: String(row.component_id),
			sellableItemName: String(row.sellable_item_name),
		})),
	});
}

export async function createAdminDownloadAsset(request: Request) {
	const currentUser = await requireAdmin(
		request,
		systemPermission("products", "update"),
	);
	if (Number(request.headers.get("content-length") ?? 0) > 101 * 1024 * 1024)
		return Response.json({ code: "request_too_large" }, { status: 413 });
	try {
		const form = await request.formData();
		const file = form.get("file");
		if (!(file instanceof File))
			return Response.json({ code: "file_required" }, { status: 400 });
		const env = getEnv();
		const result = await createDownloadAsset(env.DB, env.FILES, {
			productId: String(form.get("productId") ?? ""),
			componentId: String(form.get("componentId") ?? ""),
			fileName: file.name,
			contentType: file.type || "application/octet-stream",
			body: await file.arrayBuffer(),
			actorUserId: currentUser.id,
			request,
		});
		return Response.json(result, { status: 201 });
	} catch (error) {
		return domainErrorResponse(error);
	}
}

export async function updateAdminDownloadAsset(request: Request) {
	const currentUser = await requireAdmin(
		request,
		systemPermission("products", "update"),
	);
	try {
		const input = updateSchema.parse(await request.json());
		const env = getEnv();
		const now = Date.now();
		const results = await env.DB.batch([
			env.DB.prepare(
				"UPDATE download_assets SET download_enabled = ?, updated_at = ? WHERE id = ?",
			).bind(input.enabled ? 1 : 0, now, input.id),
			env.DB.prepare(
				`INSERT INTO audit_logs
				 (id, actor_user_id, action, target_type, target_id, after, created_at)
				 SELECT ?, ?, 'download_asset.status_updated', 'download_asset', id, ?, ?
				 FROM download_assets WHERE id = ? AND download_enabled = ?`,
			).bind(
				crypto.randomUUID(),
				currentUser.id,
				JSON.stringify({ enabled: input.enabled }),
				now,
				input.id,
				input.enabled ? 1 : 0,
			),
		]);
		if (Number(results[0]?.meta.changes ?? 0) !== 1)
			return Response.json({ code: "asset_not_found" }, { status: 404 });
		return Response.json({ id: input.id, enabled: input.enabled });
	} catch (error) {
		return domainErrorResponse(error);
	}
}

function domainErrorResponse(error: unknown) {
	if (error instanceof DomainError)
		return Response.json({ code: error.code }, { status: error.status });
	return Response.json({ code: "invalid_request" }, { status: 400 });
}

function resultRows(result: D1Result<unknown> | undefined) {
	return (result?.results ?? []) as Record<string, unknown>[];
}
