/**
 * Memory tool handlers — thin wrappers around memory services.
 */

import { z } from "zod";
import { retrieveMemories } from "@/lib/memory/retrieval";
import { createMemory, deleteMemory, listMemories } from "@/lib/memory/store";
import type { MemoryType } from "@/lib/memory/types";

const memoryTypeSchema = z.enum(["factual", "episodic", "procedural", "semantic"]);

export const MemorySearchSchema = z.object({
	apiKeyId: z.string(),
	query: z.string().optional(),
	type: memoryTypeSchema.optional(),
	maxTokens: z.number().int().positive().max(8000).optional(),
	limit: z.number().int().positive().max(100).optional(),
});

export const MemoryAddSchema = z.object({
	apiKeyId: z.string(),
	sessionId: z.string().optional(),
	type: memoryTypeSchema,
	key: z.string().min(1),
	content: z.string().min(1),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export const MemoryClearSchema = z.object({
	apiKeyId: z.string(),
	type: memoryTypeSchema.optional(),
	olderThan: z.string().optional(),
});

export const memoryTools = {
	omniroute_memory_search: {
		name: "omniroute_memory_search",
		description: "Search memories by query, type, or API key with token budget enforcement",
		inputSchema: MemorySearchSchema,
		handler: async (args: z.infer<typeof MemorySearchSchema>) => {
			const retrievalConfig = {
				enabled: true,
				maxTokens: args.maxTokens || 2000,
				retrievalStrategy: "exact" as const,
				autoSummarize: false,
				persistAcrossModels: false,
				retentionDays: 30,
				scope: "apiKey" as const,
				query: args.query,
			};

			const memories = await retrieveMemories(args.apiKeyId, retrievalConfig);
			const filteredMemories = args.type
				? memories.filter((memory) => memory.type === args.type)
				: memories;
			const limitedMemories = args.limit
				? filteredMemories.slice(0, args.limit)
				: filteredMemories;

			return {
				success: true,
				data: {
					memories: limitedMemories,
					count: limitedMemories.length,
					totalTokens: limitedMemories.reduce(
						(sum, memory) => sum + Math.ceil(memory.content.length / 4),
						0
					),
				},
			};
		},
	},

	omniroute_memory_add: {
		name: "omniroute_memory_add",
		description: "Add a new memory entry",
		inputSchema: MemoryAddSchema,
		handler: async (args: z.infer<typeof MemoryAddSchema>) => {
			const memory = await createMemory({
				apiKeyId: args.apiKeyId,
				sessionId: args.sessionId || "",
				type: args.type as MemoryType,
				key: args.key,
				content: args.content,
				metadata: args.metadata || {},
				expiresAt: null,
			});

			return {
				success: true,
				data: {
					memory,
					message: "Memory created successfully",
				},
			};
		},
	},

	omniroute_memory_clear: {
		name: "omniroute_memory_clear",
		description: "Clear memories for an API key, optionally filtered by type or age",
		inputSchema: MemoryClearSchema,
		handler: async (args: z.infer<typeof MemoryClearSchema>) => {
			const result = await listMemories({
				apiKeyId: args.apiKeyId,
				type: args.type as MemoryType | undefined,
			});
			const existingMemories = Array.isArray(result)
				? result
				: Array.isArray(result?.data)
					? result.data
					: [];

			const cutoff = args.olderThan ? new Date(args.olderThan) : null;
			const memoriesToDelete = cutoff
				? existingMemories.filter((memory) => new Date(memory.createdAt) < cutoff)
				: existingMemories;

			let deletedCount = 0;
			for (const memory of memoriesToDelete) {
				await deleteMemory(memory.id);
				deletedCount++;
			}

			return {
				success: true,
				data: {
					deletedCount,
					message: `Cleared ${deletedCount} memories`,
				},
			};
		},
	},
};
