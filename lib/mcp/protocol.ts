import { MCP_PROTOCOL_VERSION, MCP_SERVER_NAME } from "./config";
import {
  callTool,
  listToolsFor,
  ToolForbiddenError,
  ToolInputError,
  ToolNotFoundError,
  type ToolContext,
} from "./tools";

/**
 * The MCP message layer: JSON-RPC 2.0 over HTTP.
 *
 * ── WHY THIS IS HAND-WRITTEN ─────────────────────────────────────────────────
 * The official SDK would pull in a dependency (and a transport abstraction
 * built for long-lived stdio/SSE processes) to implement five message types
 * over a stateless POST. This repo requires asking before adding dependencies
 * (`.claude/rules/workflow.md`), and the same reasoning already applies to
 * `lib/support-token.ts`, which hand-rolls JWT signing. If this server grows
 * resources, prompts, sampling or server-initiated notifications, revisit that
 * trade-off — those are where the SDK earns its keep.
 *
 * ── STATELESS BY DESIGN ──────────────────────────────────────────────────────
 * No session ids, no server-to-client stream. Every request carries its bearer
 * token and is answered on its own; nothing is held between calls. That is what
 * makes this work on serverless functions, where a "session" living in one
 * instance's memory is a coin flip.
 */

// ── JSON-RPC types ──────────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** The subset of JSON-RPC error codes this server uses. */
export const JSON_RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data ? { data } : {}) },
  };
}

function jsonRpcResult(
  id: string | number | null,
  result: unknown
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

/** A notification has no `id` and must not be answered. */
export function isNotification(message: JsonRpcRequest): boolean {
  return message.id === undefined || message.id === null;
}

// ── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Handle one JSON-RPC message.
 *
 * Returns `null` for notifications, which the caller turns into a 202 with no
 * body — answering a notification is a protocol violation that some clients
 * treat as a hard error.
 */
export async function handleMessage(
  message: JsonRpcRequest,
  ctx: ToolContext
): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;

  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return jsonRpcError(
      id,
      JSON_RPC.INVALID_REQUEST,
      "Invalid JSON-RPC request."
    );
  }

  switch (message.method) {
    case "initialize": {
      // The client's requested protocol version is echoed back when we can
      // speak it, otherwise ours is offered and the client decides whether to
      // continue. Blindly echoing an unknown version would promise behaviour
      // this server does not implement.
      const requested = (message.params as { protocolVersion?: string })
        ?.protocolVersion;

      return jsonRpcResult(id, {
        protocolVersion:
          requested === MCP_PROTOCOL_VERSION ? requested : MCP_PROTOCOL_VERSION,
        // Only tools. Declaring a capability we do not serve makes clients
        // call into a method that then fails.
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, version: "1.0.0" },
      });
    }

    // Sent by the client once it has finished initializing. Nothing to do —
    // there is no per-session state to unlock.
    case "notifications/initialized":
      return null;

    case "ping":
      return jsonRpcResult(id, {});

    case "tools/list":
      return jsonRpcResult(id, { tools: listToolsFor(ctx) });

    case "tools/call": {
      const params = message.params as
        | { name?: string; arguments?: unknown }
        | undefined;

      if (!params?.name || typeof params.name !== "string") {
        return jsonRpcError(
          id,
          JSON_RPC.INVALID_PARAMS,
          "A tool name is required."
        );
      }

      try {
        const result = await callTool(params.name, params.arguments, ctx);

        return jsonRpcResult(id, {
          // Text content holding JSON is the interoperable shape: every client
          // renders it, and models parse it reliably. `structuredContent`
          // carries the same data for clients that prefer it.
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          isError: false,
        });
      } catch (error) {
        // A tool that refuses or is handed bad input is a TOOL error, not a
        // protocol error: it comes back as a successful result with
        // `isError: true` so the model can read the reason and correct itself,
        // instead of a JSON-RPC error the client surfaces as a broken server.
        if (
          error instanceof ToolNotFoundError ||
          error instanceof ToolForbiddenError ||
          error instanceof ToolInputError
        ) {
          return jsonRpcResult(id, {
            content: [{ type: "text", text: error.message }],
            isError: true,
          });
        }

        // Anything else is ours. Log it server-side; the client gets a generic
        // sentence, never a stack trace or a database error.
        console.error("[mcp:tools/call]", params.name, error);
        return jsonRpcResult(id, {
          content: [
            {
              type: "text",
              text: "The tool failed unexpectedly. The error has been logged.",
            },
          ],
          isError: true,
        });
      }
    }

    default:
      // Unknown notifications are swallowed rather than answered; unknown
      // requests get a proper method-not-found.
      if (isNotification(message)) return null;
      return jsonRpcError(
        id,
        JSON_RPC.METHOD_NOT_FOUND,
        `Unsupported method: ${message.method}`
      );
  }
}
