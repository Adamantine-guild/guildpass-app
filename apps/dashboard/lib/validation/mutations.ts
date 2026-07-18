import { z } from "zod";
import { MEMBER_ROLES } from "@/lib/member-roles";

export type FieldValidationError = {
  field: string;
  message: string;
};

type ValidationResult<T> =
  | { valid: true; data: T }
  | { valid: false; errors: FieldValidationError[] };

export type PassCreateInput = z.infer<typeof passCreateSchema>;
export type PassUpdateInput = z.infer<typeof passUpdateSchema>;
export type MemberCreateInput = z.infer<typeof memberCreateSchema>;
export type MemberUpdateInput = z.infer<typeof memberUpdateSchema>;

const PASS_STATUSES = ["active", "inactive", "draft"] as const;
const MEMBER_STATUSES = ["active", "inactive", "pending"] as const;
// guildId is server-owned: the tenant scope comes from the server-side guild
// context, never from the payload (see docs/multi-tenancy.md).
const SERVER_OWNED_FIELDS = ["id", "createdAt", "guildId"] as const;
const WALLET_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateServerOwnedFields(
  payload: Record<string, unknown>,
  errors: FieldValidationError[]
): void {
  for (const field of SERVER_OWNED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      errors.push({
        field,
        message: `${field} is managed by the server and cannot be provided`,
      });
    }
  }
}

function flattenZodIssues(issues: z.ZodIssue[]): z.ZodIssue[] {
  return issues.flatMap((issue) => {
    if (issue.code === "invalid_union") {
      return issue.unionErrors.flatMap((error) => flattenZodIssues(error.issues));
    }
    if (issue.code === "invalid_union_discriminator") {
      return issue.unionErrors.flatMap((error) => flattenZodIssues(error.issues));
    }
    return issue;
  });
}

function parseField<T>(
  schema: z.ZodType<T>,
  value: unknown,
  fieldName: string,
  errors: FieldValidationError[],
  rootInvalidTypeMessage?: string
): T | undefined {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const seen = new Set<string>();
  for (const issue of flattenZodIssues(result.error.issues)) {
    const path = issue.path.length > 0 ? `${fieldName}.${issue.path.join(".")}` : fieldName;
    let message = issue.message;

    if (issue.code === "invalid_type") {
      if (issue.message === "Required") {
        message = rootInvalidTypeMessage ?? `${fieldName} is required`;
      } else if (issue.path.length > 0 && fieldName === "roles") {
        message = `role must be one of: ${MEMBER_ROLES.join(", ")}`;
      } else {
        message =
          rootInvalidTypeMessage ??
          (issue.expected === "string"
            ? `${path} must be a non-empty string`
            : issue.expected === "number"
            ? `${path} must be a number`
            : issue.expected === "array"
            ? `${path} must be an array`
            : issue.message);
      }
    }

    const errorKey = `${path}:${message}`;
    if (seen.has(errorKey)) continue;
    seen.add(errorKey);
    errors.push({ field: path, message });
  }

  return undefined;
}

const requiredStringField = (name: string) =>
  z.string().trim().min(1, { message: `${name} is required` });

const optionalNonEmptyStringField = (name: string) =>
  z.string().trim().min(1, { message: `${name} must be a non-empty string` });

const optionalNumberField = (name: string) =>
  z.number({ invalid_type_error: `${name} must be a number` })
    .finite({ message: `${name} must be a number` })
    .nonnegative({ message: `${name} must be greater than or equal to 0` });

const optionalIntegerField = (name: string) =>
  optionalNumberField(name).int({ message: `${name} must be an integer` });

const isoDateField = (name: string) =>
  z
    .string()
    .trim()
    .min(1, { message: `${name} must be an ISO date string` })
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: `${name} must be an ISO date string`,
    });

const requiredWalletField = z
  .string()
  .trim()
  .min(1, { message: "wallet is required" })
  .regex(WALLET_ADDRESS_PATTERN, { message: "wallet must be a valid Ethereum address" });

const optionalWalletField = z
  .string()
  .trim()
  .min(1, { message: "wallet must be a non-empty string" })
  .regex(WALLET_ADDRESS_PATTERN, { message: "wallet must be a valid Ethereum address" });

const rolesField = z
  .array(
    z.string().refine((value) => MEMBER_ROLES.includes(value), {
      message: `role must be one of: ${MEMBER_ROLES.join(", ")}`,
    })
  )
  .optional();

export const passCreateSchema = z.object({
  name: requiredStringField("name"),
  description: requiredStringField("description"),
  price: optionalNumberField("price").optional(),
  maxSupply: z.union([optionalIntegerField("maxSupply"), z.null()]).optional(),
  currentSupply: optionalIntegerField("currentSupply").optional(),
  status: z
    .enum(PASS_STATUSES, {
      errorMap: () => ({
        message: `status must be one of: ${PASS_STATUSES.join(", ")}`,
      }),
    })
    .optional(),
}).passthrough();

export const passUpdateSchema = z.object({
  name: optionalNonEmptyStringField("name").optional(),
  description: optionalNonEmptyStringField("description").optional(),
  price: optionalNumberField("price").optional(),
  maxSupply: z.union([optionalIntegerField("maxSupply"), z.null()]).optional(),
  currentSupply: optionalIntegerField("currentSupply").optional(),
  status: z.enum(PASS_STATUSES, {
    errorMap: () => ({
      message: `status must be one of: ${PASS_STATUSES.join(", ")}`,
    }),
  }).optional(),
}).passthrough();

export const memberCreateSchema = z.object({
  name: requiredStringField("name"),
  wallet: requiredWalletField,
  roles: rolesField,
  status: z
    .enum(MEMBER_STATUSES, {
      errorMap: () => ({
        message: `status must be one of: ${MEMBER_STATUSES.join(", ")}`,
      }),
    })
    .optional(),
  joinedAt: isoDateField("joinedAt").optional(),
  lastActive: isoDateField("lastActive").optional(),
}).passthrough();

export const memberUpdateSchema = z.object({
  name: optionalNonEmptyStringField("name").optional(),
  wallet: optionalWalletField.optional(),
  roles: rolesField,
  status: z.enum(MEMBER_STATUSES, {
    errorMap: () => ({
      message: `status must be one of: ${MEMBER_STATUSES.join(", ")}`,
    }),
  }).optional(),
  joinedAt: isoDateField("joinedAt").optional(),
  lastActive: isoDateField("lastActive").optional(),
}).passthrough();

export function malformedPayloadError(): FieldValidationError[] {
  return [{ field: "body", message: "Request body must be a valid JSON object" }];
}

export function validatePassCreatePayload(payload: unknown): ValidationResult<PassCreateInput> {
  if (!isPlainObject(payload)) {
    return { valid: false, errors: malformedPayloadError() };
  }

  const errors: FieldValidationError[] = [];
  validateServerOwnedFields(payload, errors);

  const name = parseField(
    passCreateSchema.shape.name,
    payload.name,
    "name",
    errors,
    "name is required"
  );
  const description = parseField(
    passCreateSchema.shape.description,
    payload.description,
    "description",
    errors,
    "description is required"
  );
  const price = parseField(passCreateSchema.shape.price, payload.price, "price", errors);
  const maxSupply = parseField(
    passCreateSchema.shape.maxSupply,
    payload.maxSupply,
    "maxSupply",
    errors,
    "maxSupply must be a number"
  );
  const currentSupply =
    parseField(
      passCreateSchema.shape.currentSupply,
      payload.currentSupply,
      "currentSupply",
      errors,
      "currentSupply must be a number"
    ) ?? 0;
  const status =
    parseField(
      passCreateSchema.shape.status,
      payload.status ?? "draft",
      "status",
      errors,
      `status must be one of: ${PASS_STATUSES.join(", ")}`
    ) ?? "draft";

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const data: PassCreateInput = {
    name: name as string,
    description: description as string,
    status,
    currentSupply,
  };

  if (price !== undefined) data.price = price;
  if (maxSupply !== undefined) data.maxSupply = maxSupply;

  return { valid: true, data };
}

export function validatePassUpdatePayload(payload: unknown): ValidationResult<PassUpdateInput> {
  if (!isPlainObject(payload)) {
    return { valid: false, errors: malformedPayloadError() };
  }

  const errors: FieldValidationError[] = [];
  validateServerOwnedFields(payload, errors);

  const data: PassUpdateInput = {};
  const name = parseField(passUpdateSchema.shape.name, payload.name, "name", errors);
  const description = parseField(
    passUpdateSchema.shape.description,
    payload.description,
    "description",
    errors
  );
  const price = parseField(passUpdateSchema.shape.price, payload.price, "price", errors);
  const maxSupply = parseField(
    passUpdateSchema.shape.maxSupply,
    payload.maxSupply,
    "maxSupply",
    errors,
    "maxSupply must be a number"
  );
  const currentSupply = parseField(
    passUpdateSchema.shape.currentSupply,
    payload.currentSupply,
    "currentSupply",
    errors,
    "currentSupply must be a number"
  );
  const status = parseField(
    passUpdateSchema.shape.status,
    payload.status,
    "status",
    errors,
    `status must be one of: ${PASS_STATUSES.join(", ")}`
  );

  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description;
  if (price !== undefined) data.price = price;
  if (maxSupply !== undefined) data.maxSupply = maxSupply;
  if (currentSupply !== undefined) data.currentSupply = currentSupply;
  if (status !== undefined) data.status = status;

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, data };
}

export function validateMemberCreatePayload(payload: unknown): ValidationResult<MemberCreateInput> {
  if (!isPlainObject(payload)) {
    return { valid: false, errors: malformedPayloadError() };
  }

  const errors: FieldValidationError[] = [];
  validateServerOwnedFields(payload, errors);

  const name = parseField(
    memberCreateSchema.shape.name,
    payload.name,
    "name",
    errors,
    "name is required"
  );
  const wallet = parseField(
    memberCreateSchema.shape.wallet,
    payload.wallet,
    "wallet",
    errors,
    "wallet is required"
  );
  const roles = parseField(memberCreateSchema.shape.roles, payload.roles, "roles", errors, "roles must be an array") ?? [];
  const status =
    parseField(
      memberCreateSchema.shape.status,
      payload.status ?? "pending",
      "status",
      errors,
      `status must be one of: ${MEMBER_STATUSES.join(", ")}`
    ) ?? "pending";
  const joinedAt =
    parseField(memberCreateSchema.shape.joinedAt, payload.joinedAt, "joinedAt", errors, "joinedAt must be an ISO date string") ??
    new Date().toISOString();
  const lastActive =
    parseField(memberCreateSchema.shape.lastActive, payload.lastActive, "lastActive", errors, "lastActive must be an ISO date string") ??
    new Date().toISOString();

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      name: name as string,
      wallet: wallet as string,
      status,
      roles: [...new Set(roles)],
      joinedAt,
      lastActive,
    },
  };
}

export function validateMemberUpdatePayload(payload: unknown): ValidationResult<MemberUpdateInput> {
  if (!isPlainObject(payload)) {
    return { valid: false, errors: malformedPayloadError() };
  }

  const errors: FieldValidationError[] = [];
  validateServerOwnedFields(payload, errors);

  const data: MemberUpdateInput = {};
  const name = parseField(
    memberUpdateSchema.shape.name,
    payload.name,
    "name",
    errors
  );
  const wallet = parseField(
    memberUpdateSchema.shape.wallet,
    payload.wallet,
    "wallet",
    errors,
    "wallet must be a non-empty string"
  );
  const roles = parseField(memberUpdateSchema.shape.roles, payload.roles, "roles", errors, "roles must be an array");
  const joinedAt = parseField(
    memberUpdateSchema.shape.joinedAt,
    payload.joinedAt,
    "joinedAt",
    errors,
    "joinedAt must be an ISO date string"
  );
  const lastActive = parseField(
    memberUpdateSchema.shape.lastActive,
    payload.lastActive,
    "lastActive",
    errors,
    "lastActive must be an ISO date string"
  );
  const status = parseField(
    memberUpdateSchema.shape.status,
    payload.status,
    "status",
    errors,
    `status must be one of: ${MEMBER_STATUSES.join(", ")}`
  );

  if (name !== undefined) data.name = name;
  if (wallet !== undefined) data.wallet = wallet;
  if (roles !== undefined) data.roles = roles ? [...new Set(roles)] : [];
  if (joinedAt !== undefined) data.joinedAt = joinedAt;
  if (lastActive !== undefined) data.lastActive = lastActive;
  if (status !== undefined) data.status = status;

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, data };
}
