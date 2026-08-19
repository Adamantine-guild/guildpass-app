import { requireSessionAndPermission } from "@/lib/auth/require-permission";
import { getActiveGuildId } from "@/lib/guild-context";
import { getMemberRepository } from "@/lib/repositories/factory";
import { MEMBER_CSV_HEADERS, memberToCsvRow } from "@/lib/members-csv";

/**
 * GET /api/members/export
 *
 * Streams all members for the active guild as a CSV download.
 * The response is streamed via ReadableStream — members are read from the
 * repository in bounded-size chunks, so memory usage stays constant
 * regardless of guild size (O(chunkSize), not O(N)).
 *
 * Requires `members:read` permission, same as the paginated member list.
 */
export async function GET(request: Request): Promise<Response> {
  const guildId = getActiveGuildId(request);
  const guard = await requireSessionAndPermission(request, guildId, "members:read");
  if (!guard.ok) return guard.response;

  const repo = getMemberRepository();

  const encoder = new TextEncoder();
  const BOM = "\uFEFF"; // UTF-8 BOM for Excel compatibility

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Write CSV header row
        controller.enqueue(
          encoder.encode(BOM + MEMBER_CSV_HEADERS.join(",") + "\r\n"),
        );

        // Stream member rows in bounded-size chunks from the repository
        for await (const chunk of repo.streamAll(guildId)) {
          const rows = chunk.map(memberToCsvRow).join("\r\n") + "\r\n";
          controller.enqueue(encoder.encode(rows));
        }

        controller.close();
      } catch (err) {
        console.error("Error streaming member export:", err);
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="members-${guildId}.csv"`,
    },
  });
}
