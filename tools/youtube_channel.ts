import type { ToolDefinition } from "@vellumai/plugin-api";
import { ytFetch, parseChannelRef, fetchChannel, fmtCount, fmtDate, fmtVideoLine } from "../src/yt";

const tool: ToolDefinition = {
  description:
    "Get a YouTube channel overview: subscribers, total views, video count, plus its most " +
    "recent uploads with per-video stats. Accepts a channel ID (UC...), @handle, or channel " +
    "URL. Use when the user asks about a channel, a creator's performance, what someone has " +
    "uploaded lately, or wants a competitor snapshot.",
  input_schema: {
    type: "object",
    properties: {
      channel: {
        type: "string",
        description: "Channel ID (UC...), @handle, or channel URL.",
      },
      recentUploads: {
        type: "number",
        description: "How many recent uploads to include with stats, 0-25. Default: 10.",
      },
    },
    required: ["channel"],
  },
  defaultRiskLevel: "low",
  execute: async (input: any, ctx) => {
    try {
      const ref = parseChannelRef(String(input.channel));
      if (!ref) {
        return { content: `Could not parse a channel from "${input.channel}".`, isError: true };
      }
      const ch = await fetchChannel(ref, ctx);
      if (!ch) {
        return { content: `No channel found for "${input.channel}".`, isError: false };
      }

      const s = ch.statistics ?? {};
      const sn = ch.snippet ?? {};
      let content =
        `# ${sn.title}\n` +
        `- Handle: ${sn.customUrl ?? "?"} | ID: ${ch.id}\n` +
        `- Subscribers: ${fmtCount(s.subscriberCount)} | Total views: ${fmtCount(s.viewCount)} | ` +
        `Videos: ${fmtCount(s.videoCount)}\n` +
        `- Created: ${fmtDate(sn.publishedAt)}\n` +
        `- About: ${(sn.description ?? "").slice(0, 300)}`;

      const n = Math.min(Math.max(Number(input.recentUploads ?? 10), 0), 25);
      const uploadsId = ch.contentDetails?.relatedPlaylists?.uploads;
      if (n > 0 && uploadsId) {
        const pl = await ytFetch(
          "playlistItems",
          { part: "contentDetails", playlistId: uploadsId, maxResults: n },
          ctx,
        );
        const ids = (pl.items ?? [])
          .map((it: any) => it.contentDetails?.videoId)
          .filter(Boolean);
        if (ids.length > 0) {
          const vids = await ytFetch(
            "videos",
            { part: "snippet,statistics,contentDetails", id: ids.join(",") },
            ctx,
          );
          const lines = (vids.items ?? []).map(
            (v: any, i: number) => `${i + 1}. ${fmtVideoLine(v)}`,
          );
          content += `\n\n## Recent uploads\n${lines.join("\n")}`;
        }
      }

      return { content, isError: false };
    } catch (err: any) {
      return { content: String(err?.message ?? err), isError: true };
    }
  },
};

export default tool;
