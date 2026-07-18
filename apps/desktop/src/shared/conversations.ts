import { z } from "zod";
import { workspaceModeSchema } from "./settings";

export const conversationIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const conversationWorkspaceSchema = z.string().max(4_096);

export const conversationToolActivitySchema = z.object({
  callId: z.string().max(200),
  name: z.string().max(80),
  status: z.enum(["started", "completed", "error"]),
  detail: z.string().max(500).optional(),
});

export const conversationMessageSchema = z.object({
  id: conversationIdSchema,
  role: z.enum(["user", "assistant"]),
  content: z.string().max(32_000),
  state: z.enum(["complete", "cancelled", "error"]),
  toolProgress: z.array(z.string().max(4_000)).max(32).optional(),
  toolEvents: z.array(conversationToolActivitySchema).max(128).optional(),
});

const conversationObjectSchema = z.object({
  id: conversationIdSchema,
  title: z.string().trim().min(1).max(80),
  providerId: z.string().max(100),
  workspace: conversationWorkspaceSchema,
  mode: workspaceModeSchema.default("code"),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  contextSummary: z.string().max(32_000).default(""),
  summarizedMessageCount: z.number().int().nonnegative().default(0),
  messages: z.array(conversationMessageSchema),
});

export const conversationSchema = conversationObjectSchema.superRefine(
  (conversation, context) => {
    if (conversation.summarizedMessageCount > conversation.messages.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Summarized message count exceeds conversation history.",
        path: ["summarizedMessageCount"],
      });
    }
  },
);

export const conversationSummarySchema = conversationObjectSchema.pick({
  id: true,
  title: true,
  providerId: true,
  workspace: true,
  mode: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  messageCount: z.number().int().nonnegative(),
});

export const conversationCompactionRequestSchema = z
  .object({
    providerId: z.string().min(1).max(100),
    priorSummary: z.string().max(32_000),
    messages: z.array(conversationMessageSchema).min(1).max(48),
  })
  .superRefine((request, context) => {
    const characterCount = request.messages.reduce(
      (total, message) => total + message.content.length,
      0,
    );
    if (characterCount > 120_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Compaction chunk exceeds 120,000 characters.",
        path: ["messages"],
      });
    }
  });

export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type ConversationToolActivity = z.infer<typeof conversationToolActivitySchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type ConversationCompactionRequest = z.infer<
  typeof conversationCompactionRequestSchema
>;
