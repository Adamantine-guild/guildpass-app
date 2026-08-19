import type { Member } from "./mock-data";

export const MEMBER_CSV_HEADERS = ["Name", "Wallet", "Status", "Roles", "Joined At", "Last Active"];

function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

/** Serialize a single member to a CSV row (no trailing newline). */
export function memberToCsvRow(member: Member): string {
  return [
    member.name,
    member.wallet,
    member.status,
    (member.roles ?? []).join("; "),
    member.joinedAt,
    member.lastActive,
  ]
    .map((cell) => escapeCsvCell(String(cell)))
    .join(",");
}

/** Serialize an array of members to a full CSV string including headers. */
export function toMembersCsv(members: Member[]): string {
  return [MEMBER_CSV_HEADERS.join(","), ...members.map(memberToCsvRow)].join("\r\n");
}
