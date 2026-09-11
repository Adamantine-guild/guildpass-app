export interface Member {
  readonly id: string;
  readonly walletAddress: string;
  readonly guildId?: string;
  readonly roles?: readonly string[];
  readonly status?: string;
}