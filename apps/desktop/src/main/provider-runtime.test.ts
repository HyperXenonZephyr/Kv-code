import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderConfig } from "../shared/providers";
import {
  compactProviderContext,
  streamProviderResponse,
  testProviderConnection,
} from "./provider-runtime";

let server: Server | null = null;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => error ? reject(error) : resolve());
  });
  server = null;
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
