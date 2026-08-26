import { z } from "zod";
import type { AutomationQueueMessage } from "#/server/queue/types";

const payloadSchema = z.object({ automationJobId: z.uuid() });

export async function publishPendingBuilds(
	db: D1Database,
	queue: Queue<AutomationQueueMessage>,
	limit = 25,
) {
	const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
	const rows = await db
		.prepare(
			`SELECT id, payload FROM outbox_events
			 WHERE event_type = 'automation.requested' AND status = 'pending'
			 AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
			 ORDER BY created_at, id LIMIT ?`,
		)
		.bind(Date.now(), boundedLimit)
		.all<{ id: string; payload: string }>();
	if (!rows.results.length) return { published: 0 };
	const messages = rows.results.map((row) => ({
		outboxId: row.id,
		body: {
			kind: "commerce.automation",
			version: 1,
			automationJobId: payloadSchema.parse(JSON.parse(row.payload))
				.automationJobId,
		} satisfies AutomationQueueMessage,
	}));
	await queue.sendBatch(messages.map(({ body }) => ({ body })));
	const now = Date.now();
	await db.batch(
		messages.map(({ outboxId }) =>
			db
				.prepare(
					`UPDATE outbox_events SET status = 'published', published_at = ?,
					 updated_at = ? WHERE id = ? AND status = 'pending'`,
				)
				.bind(now, now, outboxId),
		),
	);
	return { published: messages.length };
}
