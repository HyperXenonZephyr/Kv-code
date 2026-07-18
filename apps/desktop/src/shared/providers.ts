import { z } from "zod";
import { reasoningEffortSchema, workspaceModeSchema } from "./settings";

export const providerProtocolSchema = z.enum([
  "openai-responses",
  "openai-chat",
  "anthropic",
  "google-gemini",
]);

const providerBaseUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1";
  }, "Provider URLs must use HTTPS, except for local endpoints.");

export const providerConfigSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(80),
  protocol: providerProtocolSchema,
  baseUrl: providerBaseUrlSchema,
  model: z.string().trim().min(1).max(200),
});

export const providerSaveInputSchema = providerConfigSchema.extend({
  apiKey: z.string().max(1_024).optional(),
});

export const providerSummarySchema = providerConfigSchema.extend({
  hasApiKey: z.boolean(),
});

export const providerTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  latencyMs: z.number().nonnegative(),
});

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(32_000),
});

export const chatStartRequestSchema = z
  .object({
    turnId: z.string().min(1).max(100),
    providerId: z.string().min(1).max(100),
    workspace: z.string().max(4_096),
    mode: workspaceModeSchema,
    reasoning: reasoningEffortSchema,
    additionalInstructions: z.string().max(4_000),
    messages: z.array(chatMessageSchema).min(1).max(64),
  })
  .superRefine((request, context) => {
    const totalCharacters = request.messages.reduce(
      (total, message) => total + message.content.length,
      0,
    );
    if (totalCharacters > 240_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Conversation context exceeds the 240,000 character limit.",
        path: ["messages"],
      });
    }
  });

export const chatEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("delta"),
    turnId: z.string(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("done"),
    turnId: z.string(),
  }),
  z.object({
    type: z.literal("cancelled"),
    turnId: z.string(),
  }),
  z.object({
    type: z.literal("error"),
    turnId: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal("tool"),
    turnId: z.string(),
    callId: z.string().max(200),
    name: z.string().max(80),
    status: z.enum(["started", "completed", "error"]),
    detail: z.string().max(500).optional(),
  }),
]);

export type ProviderProtocol = z.infer<typeof providerProtocolSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type ProviderSaveInput = z.infer<typeof providerSaveInputSchema>;
export type ProviderSummary = z.infer<typeof providerSummarySchema>;
export type ProviderTestResult = z.infer<typeof providerTestResultSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatStartRequest = z.infer<typeof chatStartRequestSchema>;
export type ChatEvent = z.infer<typeof chatEventSchema>;

export const providerPresets: ReadonlyArray<{
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  model: string;
}> = [
  {
    id: "openai",
    name: "OpenAI",
    protocol: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.1",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-5",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    protocol: "google-gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-pro",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "openai-chat",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    protocol: "openai-chat",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-5.1",
  },
  {
    id: "moonshot",
    name: "Moonshot",
    protocol: "openai-chat",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-32k",
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    protocol: "openai-chat",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3",
  },
];
