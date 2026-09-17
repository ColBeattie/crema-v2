import { describe, expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";
import { MCP_PROTOCOL_VERSION } from "./config";
import { handleMessage } from "./protocol";
import type { ToolContext } from "./tools";

/**
 * Message-layer behaviour that no type checker catches.
 *
 * The cases here are the ones where getting it wrong produces a server that
 * *looks* fine: a notification that gets answered (some clients treat that as
 * a protocol violation and drop the connection), a tool advertised to someone
 * who is not allowed to call it, or a refusal returned as a JSON-RPC error
 * rather than a tool result — which the client surfaces as "this server is
 * broken" instead of letting the model read the reason and adjust.
 *
 * Every case below stops before any database access: `tools/list` reads the
 * registry, and the two `tools/call` cases are rejected by the dispatcher
 * before a handler runs. So this file needs no Supabase.
 */

function contextFor(role: "admin" | "user"): ToolContext {
  return {
    user: {
      id: "00000000-0000-0000-0000-000000000001",
      email: "someone@example.com",
      app_metadata: { role },
      user_metadata: {},
      aud: "authenticated",
      created_at: "2026-01-01T00:00:00.000Z",
    } as unknown as User,
    isAdmin: role === "admin",
  };
}

const adminCtx = contextFor("admin");
const userCtx = contextFor("user");

describe("initialize", () => {
  it("reports the protocol version and only the capabilities we serve", async () => {
    const response = await handleMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      adminCtx
    );

    const result = response?.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    // Declaring a capability we don't implement makes clients call into a
    // method that then fails.
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
  });

  it("does not echo back a protocol version it cannot speak", async () => {
    const response = await handleMessage(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "1999-01-01" },
      },
      adminCtx
    );

    expect(
      (response?.result as { protocolVersion: string }).protocolVersion
    ).toBe(MCP_PROTOCOL_VERSION);
  });
});

describe("notifications", () => {
  it("returns nothing for notifications/initialized", async () => {
    expect(
      await handleMessage(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        adminCtx
      )
    ).toBeNull();
  });

  it("swallows an unknown notification instead of erroring", async () => {
    expect(
      await handleMessage(
        { jsonrpc: "2.0", method: "notifications/something-new" },
        adminCtx
      )
    ).toBeNull();
  });

  it("still reports method-not-found for an unknown request", async () => {
    const response = await handleMessage(
      { jsonrpc: "2.0", id: 7, method: "resources/list" },
      adminCtx
    );
    expect(response?.error?.code).toBe(-32601);
  });
});

describe("tools/list", () => {
  it("advertises the full read-only set to an admin", async () => {
    const response = await handleMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      adminCtx
    );

    const names = (response?.result as { tools: { name: string }[] }).tools.map(
      (t) => t.name
    );

    expect(names).toEqual(
      expect.arrayContaining([
        "whoami",
        "list_users",
        "get_user",
        "list_audit_log",
        "list_login_attempts",
        "get_settings",
      ])
    );
  });

  it("hides admin-only tools from a non-admin", async () => {
    const response = await handleMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      userCtx
    );

    const names = (response?.result as { tools: { name: string }[] }).tools.map(
      (t) => t.name
    );

    expect(names).toEqual(["whoami"]);
  });

  it("emits bare object schemas, with no $schema key", async () => {
    const response = await handleMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      adminCtx
    );

    for (const tool of (response?.result as { tools: Record<string, any>[] })
      .tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.$schema).toBeUndefined();
    }
  });
});

describe("tools/call", () => {
  it("refuses an admin-only tool for a non-admin", async () => {
    const response = await handleMessage(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "list_users", arguments: {} },
      },
      userCtx
    );

    const result = response?.result as { isError: boolean };
    // A refusal is a TOOL error, not a protocol error — the model must be able
    // to read the reason rather than the client reporting a broken server.
    expect(response?.error).toBeUndefined();
    expect(result.isError).toBe(true);
  });

  it("reports an unknown tool as a tool error", async () => {
    const response = await handleMessage(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "drop_everything", arguments: {} },
      },
      adminCtx
    );

    expect((response?.result as { isError: boolean }).isError).toBe(true);
  });

  it("rejects a call with no tool name as invalid params", async () => {
    const response = await handleMessage(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: {} },
      adminCtx
    );
    expect(response?.error?.code).toBe(-32602);
  });

  it("runs a tool that needs no database access", async () => {
    const response = await handleMessage(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "whoami", arguments: {} },
      },
      adminCtx
    );

    const result = response?.result as {
      isError: boolean;
      structuredContent: { email: string; is_admin: boolean };
    };
    expect(result.isError).toBe(false);
    expect(result.structuredContent.email).toBe("someone@example.com");
    expect(result.structuredContent.is_admin).toBe(true);
  });
});

describe("malformed messages", () => {
  it("rejects a message that is not JSON-RPC 2.0", async () => {
    const response = await handleMessage(
      { jsonrpc: "1.0", id: 1, method: "initialize" } as never,
      adminCtx
    );
    expect(response?.error?.code).toBe(-32600);
  });
});
