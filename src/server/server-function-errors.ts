import { createMiddleware } from "@tanstack/react-start";
import { getRequest, setResponseStatus } from "@tanstack/react-start/server";
import { z } from "zod";

import { AccessDeniedError } from "#/features/access/server/access-cache";
import { DomainError } from "#/lib/domain-error";
import { requestId } from "#/server/http";

export class ServerFunctionError extends DomainError {
	constructor(
		code: string,
		status: number,
		message: string,
		readonly requestId?: string,
	) {
		super(code, status, message);
		this.name = "ServerFunctionError";
		for (const property of Object.getOwnPropertyNames(this)) {
			if (
				!["name", "message", "code", "status", "requestId"].includes(property)
			)
				Reflect.deleteProperty(this, property);
		}
	}
}

export const serverFunctionErrorMiddleware = createMiddleware({
	type: "function",
}).server(async ({ next, serverFnMeta }) => {
	try {
		return await next();
	} catch (error) {
		const request = getRequest();
		const normalized = normalizeServerFunctionError(error, request);
		setResponseStatus(normalized.status);
		if (normalized.code === "internal_error") {
			console.error(
				JSON.stringify({
					event: "server_function_failed",
					requestId: normalized.requestId,
					serverFunction: serverFnMeta?.name ?? "unknown",
					errorType: safeErrorType(error),
				}),
			);
		}
		throw normalized;
	}
});

export function normalizeServerFunctionError(
	error: unknown,
	request: Request,
): ServerFunctionError {
	if (error instanceof ServerFunctionError) return error;
	if (error instanceof DomainError) {
		return new ServerFunctionError(error.code, error.status, error.message);
	}
	if (error instanceof AccessDeniedError) {
		return new ServerFunctionError(
			error.status === 401 ? "unauthorized" : "forbidden",
			error.status,
			error.message,
		);
	}
	if (error instanceof z.ZodError) {
		const issues = error.issues
			.map((i) => `${i.path.join(".")}: ${i.message}`)
			.join("; ");
		return new ServerFunctionError("invalid_input", 400, `Invalid request: ${issues}`);
	}
	return new ServerFunctionError(
		"internal_error",
		500,
		"Internal server error",
		requestId(request),
	);
}

const safeErrorNames = new Set([
	"AccessDeniedError",
	"DomainError",
	"Error",
	"RangeError",
	"ReferenceError",
	"SyntaxError",
	"TypeError",
	"URIError",
	"ZodError",
]);

function safeErrorType(error: unknown) {
	return error instanceof Error && safeErrorNames.has(error.name)
		? error.name
		: error instanceof Error
			? "Error"
			: typeof error;
}
