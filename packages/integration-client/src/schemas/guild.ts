import { z } from "zod";

export const guildSchema = z.object({
  name: z
    .string()
    .min(1, { message: "Guild name is required" })
    .trim(),
  description: z
    .string()
    .max(500, { message: "Description cannot exceed 500 characters" })
    .trim(),
  memberCount: z
    .number()
    .int({ message: "Member cap must be an integer" })
    .positive({ message: "Member cap must be a positive number" })
    .optional()
    .default(0),
  passCount: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(0),
});

// Export the inferred type for use in both frontend and backend
export type GuildPayload = z.infer<typeof guildSchema>;