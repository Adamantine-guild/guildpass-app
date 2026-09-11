export interface Pass {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly guildId?: string;
  readonly status?: string;
}