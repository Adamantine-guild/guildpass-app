/**
 * Integration Status types for GuildPass dashboard integrations.
 */

export type IntegrationStatus = "disabled" | "configured" | "healthy" | "unhealthy" | "unknown";

export interface IntegrationDetails {
  id: string;
  name: string;
  description: string;
  optional: boolean;
  status: IntegrationStatus;
  message: string;
  lastChecked?: string;
  details?: {
    hasToken?: boolean;
    hasClientId?: boolean;
    hasGuildId?: boolean;
    missingEnvVars?: string[];
    [key: string]: any;
  };
}

export interface IntegrationAdapter {
  getDetails(): Promise<IntegrationDetails>;
}
