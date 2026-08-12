import { publishPendingBuilds } from "#/features/builds/server/outbox";
import { publishPendingDeliveries } from "#/features/fulfillment/server/outbox";
import { publishPendingNotifications } from "#/features/notifications/server/delivery";
import { fanOutPendingCommerceNotifications } from "#/features/notifications/server/fanout";
import { expireStoreOrders } from "#/features/shop-orders/server/expiration";
import { publishPendingRefunds } from "#/features/shop-payments/server/refunds";
import { publishPendingSupplierOrders } from "#/features/suppliers/server/outbox";
import { runTelegramMaintenance } from "#/features/telegram/server/maintenance";
import { runMaintenance } from "#/server/scheduled/maintenance";

export { runMaintenance };

export function handleScheduled(
	controller: ScheduledController,
	env: Env,
	context: ExecutionContext,
): void {
	context.waitUntil(
		runScheduledCommerceWork(env, controller.cron, controller.scheduledTime),
	);
}

export async function runScheduledCommerceWork(
	env: Env,
	cron: string,
	scheduledAt: number,
) {
	const publishBatchSize = await loadPublishBatchSize(env.DB);
	const expired = await expireStoreOrders(env.DB, scheduledAt);
	const deliveries = await publishPendingDeliveries(
		env.DB,
		env.COMMERCE_QUEUE,
		publishBatchSize,
	);
	const suppliers = await publishPendingSupplierOrders(
		env.DB,
		env.COMMERCE_QUEUE,
		publishBatchSize,
	);
	const builds = await publishPendingBuilds(
		env.DB,
		env.COMMERCE_QUEUE,
		publishBatchSize,
	);
	const refunds = await publishPendingRefunds(
		env.DB,
		env.COMMERCE_QUEUE,
		publishBatchSize,
	);
	const notificationEvents = await fanOutPendingCommerceNotifications(
		env.DB,
		publishBatchSize,
	);
	const notifications = await publishPendingNotifications(
		env.DB,
		env.COMMERCE_QUEUE,
		publishBatchSize,
	);
	const telegram = await runTelegramMaintenance(env.DB, scheduledAt);
	const maintenance = await runMaintenance(env, cron, undefined, scheduledAt);
	return {
		expired,
		deliveries,
		suppliers,
		builds,
		refunds,
		notificationEvents,
		notifications,
		telegram,
		maintenance,
	};
}

async function loadPublishBatchSize(db: D1Database) {
	const row = await db
		.prepare(
			"SELECT value FROM system_settings WHERE key = 'queue.publish_batch_size' LIMIT 1",
		)
		.first<{ value: string }>();
	if (!row) return 25;
	try {
		const value: unknown = JSON.parse(row.value);
		return typeof value === "number" && value >= 1 && value <= 100 ? value : 25;
	} catch {
		return 25;
	}
}
