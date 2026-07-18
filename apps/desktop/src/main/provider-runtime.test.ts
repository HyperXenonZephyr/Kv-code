import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderConfig } from "../shared/providers";
import {
  compactProviderContext,
  streamProviderResponse,
  testProviderConnection,
} from "./provider-runtime";

let server: Server | null = null;
let toolWorkspace = "";

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => error ? reject(error) : resolve());
  });
  server = null;
  if (toolWorkspace) await rm(toolWorkspace, { recursive: true, force: true });
  toolWorkspace = "";
});

describe("provider runtime", () => {
  it("streams chat history without tools and verifies the provider", async () => {
    let requestBody: any = null;
    server = createServer((request, response) => {
      if (request.url === "/v1/models") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"data":[]}');
        return;
      }
      if (request.url !== "/v1/chat/completions") {
        response.writeHead(404).end();
        return;
      }

      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        requestBody = JSON.parse(body);
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        response.write('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n');
        response.write('data: {"choices":[{"delta":{"content":"world"}}]}\n\n');
        response.end("data: [DONE]\n\n");
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test address");

    const provider: ProviderConfig = {
      id: "local-test",
      name: "Local test",
      protocol: "openai-chat",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      model: "test-model",
    };
    const connection = await testProviderConnection(provider, "");
    const deltas: string[] = [];
    await streamProviderResponse({
      provider,
      apiKey: "",
      systemPrompt: "SYSTEM PROMPT",
      reasoning: "high",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
        { role: "user", content: "third" },
      ],
      signal: new AbortController().signal,
      onDelta: (text) => deltas.push(text),
    });

    expect(connection.ok).toBe(true);
    expect(deltas.join("")).toBe("Hello world");
    expect(requestBody).toEqual({
      model: "test-model",
      messages: [
        { role: "system", content: "SYSTEM PROMPT" },
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
        { role: "user", content: "third" },
      ],
      stream: true,
    });
    expect(requestBody).not.toHaveProperty("tools");
  });

  it("falls back to chat completions when a compatible provider lacks Responses", async () => {
    const requestedPaths: string[] = [];
    server = createServer((request, response) => {
      requestedPaths.push(request.url ?? "");
      if (request.url === "/v1/responses") {
        response.writeHead(404).end();
        return;
      }
      if (request.url === "/v1/chat/completions") {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end('data: {"choices":[{"delta":{"content":"fallback"}}]}\n\ndata: [DONE]\n\n');
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test address");

    const deltas: string[] = [];
    await streamProviderResponse({
      provider: {
        id: "compatible-test",
        name: "Compatible test",
        protocol: "openai-responses",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: "chat-only-model",
      },
      apiKey: "",
      systemPrompt: "SYSTEM PROMPT",
      reasoning: "high",
      messages: [{ role: "user", content: "hello" }],
      signal: new AbortController().signal,
      onDelta: (text) => deltas.push(text),
    });

    expect(requestedPaths).toEqual(["/v1/responses", "/v1/chat/completions"]);
    expect(deltas).toEqual(["fallback"]);
  });

  it("executes bounded read-only tools and continues the chat loop", async () => {
    toolWorkspace = await mkdtemp(join(tmpdir(), "kv-code-provider-tools-"));
    await writeFile(join(toolWorkspace, "main.ts"), "export const answer = 42;\n", "utf8");
    const requestBodies: any[] = [];
    let requestCount = 0;
    server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        requestBodies.push(JSON.parse(body));
        requestCount += 1;
        response.writeHead(200, { "content-type": "text/event-stream" });
        if (requestCount === 1) {
          response.end([
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"workspace_read_file","arguments":"{\\"path\\":\\"main.ts\\"}"}}]}}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
            "data: [DONE]",
            "",
          ].join("\n\n"));
        } else {
          response.end('data: {"choices":[{"delta":{"content":"Verified"}}]}\n\ndata: [DONE]\n\n');
        }
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test address");

    const deltas: string[] = [];
    await streamProviderResponse({
      provider: {
        id: "tools-test",
        name: "Tools test",
        protocol: "openai-chat",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: "test-model",
      },
      apiKey: "",
      systemPrompt: "SYSTEM PROMPT",
      reasoning: "high",
      messages: [{ role: "user", content: "Inspect the file." }],
      signal: new AbortController().signal,
      onDelta: (text) => deltas.push(text),
      tools: { workspace: toolWorkspace, mode: "code", policy: "read-only", signal: new AbortController().signal },
    });

    expect(deltas.join("")).toBe("Verified");
    expect(requestBodies[0].tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ function: expect.objectContaining({ name: "workspace_read_file" }) }),
    ]));
    expect(requestBodies[1].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "tool", tool_call_id: "call_1", content: expect.stringContaining("answer") }),
    ]));
  });

  it("executes native OpenAI Responses function calls", async () => {
    toolWorkspace = await mkdtemp(join(tmpdir(), "kv-code-responses-tools-"));
    await writeFile(join(toolWorkspace, "main.ts"), "export const answer = 42;\n", "utf8");
    const requestBodies: any[] = [];
    server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        requestBodies.push(JSON.parse(body));
        response.writeHead(200, { "content-type": "text/event-stream" });
        if (requestBodies.length === 1) {
          response.end([
            'data: {"type":"response.created","response":{"id":"resp_1"}}',
            'data: {"type":"response.output_item.done","item":{"type":"function_call","id":"item_1","call_id":"call_1","name":"workspace_read_file","arguments":"{\\"path\\":\\"main.ts\\"}"}}',
            "",
          ].join("\n\n"));
        } else {
          response.end('data: {"type":"response.output_text.delta","delta":"Responses verified"}\n\n');
        }
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test address");
    const deltas: string[] = [];
    const toolEvents: any[] = [];
    await streamProviderResponse({
      provider: { id: "responses-tools", name: "Responses", protocol: "openai-responses", baseUrl: `http://127.0.0.1:${address.port}/v1`, model: "test-model" },
      apiKey: "",
      systemPrompt: "SYSTEM",
      reasoning: "high",
      messages: [{ role: "user", content: "Read main.ts" }],
      signal: new AbortController().signal,
      onDelta: (text) => deltas.push(text),
      onToolEvent: (event) => toolEvents.push(event),
      tools: { workspace: toolWorkspace, mode: "code", policy: "read-only", signal: new AbortController().signal },
    });
    expect(deltas.join("")).toBe("Responses verified");
    expect(requestBodies[0].tools[0]).toEqual(expect.objectContaining({ type: "function", name: "workspace_list" }));
    expect(requestBodies[1]).toEqual(expect.objectContaining({ previous_response_id: "resp_1" }));
    expect(requestBodies[1].input[0]).toEqual(expect.objectContaining({ type: "function_call_output", call_id: "call_1" }));
    expect(toolEvents.at(-1)).toEqual(expect.objectContaining({ status: "completed", output: expect.stringContaining("answer") }));
  });

  it("executes native Anthropic tool_use blocks", async () => {
    toolWorkspace = await mkdtemp(join(tmpdir(), "kv-code-anthropic-tools-"));
    await writeFile(join(toolWorkspace, "main.ts"), "export const answer = 42;\n", "utf8");
    const requestBodies: any[] = [];
    server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        requestBodies.push(JSON.parse(body));
        response.writeHead(200, { "content-type": "text/event-stream" });
        if (requestBodies.length === 1) {
          response.end([
            'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"workspace_read_file","input":{}}}',
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"main.ts\\"}"}}',
            'data: {"type":"content_block_stop","index":0}',
            "",
          ].join("\n\n"));
        } else {
          response.end([
            'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Anthropic verified"}}',
            "",
          ].join("\n\n"));
        }
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test address");
    const deltas: string[] = [];
    await streamProviderResponse({
      provider: { id: "anthropic-tools", name: "Anthropic", protocol: "anthropic", baseUrl: `http://127.0.0.1:${address.port}/v1`, model: "test-model" },
      apiKey: "test-key",
      systemPrompt: "SYSTEM",
      reasoning: "high",
      messages: [{ role: "user", content: "Read main.ts" }],
      signal: new AbortController().signal,
      onDelta: (text) => deltas.push(text),
      tools: { workspace: toolWorkspace, mode: "code", policy: "read-only", signal: new AbortController().signal },
    });
    expect(deltas.join("")).toBe("Anthropic verified");
    expect(requestBodies[0].tools[0]).toEqual(expect.objectContaining({ name: "workspace_list", input_schema: expect.any(Object) }));
    expect(requestBodies[1].messages.at(-1).content[0]).toEqual(expect.objectContaining({ type: "tool_result", tool_use_id: "toolu_1" }));
  });

  it("executes native Gemini function calls", async () => {
    toolWorkspace = await mkdtemp(join(tmpdir(), "kv-code-gemini-tools-"));
    await writeFile(join(toolWorkspace, "main.ts"), "export const answer = 42;\n", "utf8");
    const requestBodies: any[] = [];
    server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        requestBodies.push(JSON.parse(body));
        response.writeHead(200, { "content-type": "text/event-stream" });
        if (requestBodies.length === 1) {
          response.end('data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"workspace_read_file","args":{"path":"main.ts"}}}]}}]}\n\n');
        } else {
          response.end('data: {"candidates":[{"content":{"parts":[{"text":"Gemini verified"}]}}]}\n\n');
        }
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test address");
    const deltas: string[] = [];
    await streamProviderResponse({
      provider: { id: "gemini-tools", name: "Gemini", protocol: "google-gemini", baseUrl: `http://127.0.0.1:${address.port}/v1beta`, model: "test-model" },
      apiKey: "",
      systemPrompt: "SYSTEM",
      reasoning: "high",
      messages: [{ role: "user", content: "Read main.ts" }],
      signal: new AbortController().signal,
      onDelta: (text) => deltas.push(text),
      tools: { workspace: toolWorkspace, mode: "code", policy: "read-only", signal: new AbortController().signal },
    });
    expect(deltas.join("")).toBe("Gemini verified");
    expect(requestBodies[0].tools[0].functionDeclarations[0]).toEqual(expect.objectContaining({ name: "workspace_list" }));
    expect(requestBodies[1].contents.at(-1).parts[0].functionResponse).toEqual(expect.objectContaining({ name: "workspace_read_file" }));
  });

  it("updates a rolling context summary without exposing tools", async () => {
    let requestBody: any = null;
    server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        requestBody = JSON.parse(body);
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end('data: {"choices":[{"delta":{"content":"Updated summary"}}]}\n\ndata: [DONE]\n\n');
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test address");

    const summary = await compactProviderContext(
      {
        id: "summary-test",
        name: "Summary test",
        protocol: "openai-chat",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: "test-model",
      },
      "",
      "Earlier summary",
      [{ role: "user", content: "New fact" }],
      new AbortController().signal,
    );

    expect(summary).toBe("Updated summary");
    expect(requestBody.messages).toEqual([
      expect.objectContaining({ role: "system" }),
      {
        role: "user",
        content: "Existing summary to update:\n<summary>\nEarlier summary\n</summary>",
      },
      { role: "user", content: "New fact" },
    ]);
    expect(requestBody).not.toHaveProperty("tools");
  });
});
