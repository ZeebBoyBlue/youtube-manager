import type { ToolDefinition } from "@vellumai/plugin-api";
import { ytFetch, fmtDate, videoUrl } from "../src/yt";

const tool: ToolDefinition = {
  description:
    "Search YouTube for videos, channels, or playlists. Supports ordering by relevance, " +
    "date, view count, or rating, and filtering by publish date or a specific channel. " +
    "Use when the user wants to find YouTube content on a topic, research what videos " +
    "exist in a niche, or locate a channel by name. Costs 100 API quota units per call — " +
    "if you already have a video or channel ID, use youtube_video or youtube_channel instead.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search terms." },
      type: {
        type: "string",
        enum: ["video", "channel", "playlist"],
        description: "Resource type to search for. Default: video.",
      },
      order: {
        type: "string",
        enum: ["relevance", "date", "viewCount", "rating"],
        description: "Sort order. Default: relevance.",
      },
      publishedAfter: {
        type: "string",
        description: "Only results published after this date (YYYY-MM-DD). Optional.",
      },
      channelId: {
        type: "string",
        description: "Restrict results to one channel (UC... id). Optional.",
      },
      maxResults: {
        type: "number",
        description: "Number of results, 1-25. Default: 10.",
      },
    },
    required: ["query"],
  },
  defaultRiskLevel: "low",
  execute: async (input: any, ctx) => {
    try {
      const type = input.type ?? "video";
      const data = await ytFetch(
        "search",
        {
          part: "snippet",
          q: String(input.query),
          type,
          order: input.order ?? "relevance",
          maxResults: Math.min(Math.max(Number(input.maxResults ?? 10), 1), 25),
          publishedAfter: input.publishedAfter
            ? new Date(input.publishedAfter).toISOString()
            : undefined,
          channelId: input.channelId,
        },
        ctx,
      );

      const items: any[] = data.items ?? [];
      if (items.length === 0) {
        return { content: `No ${type} results for "${input.query}".`, isError: false };
      }

      const lines = items.map((it, i) => {
        const sn = it.snippet ?? {};
        if (type === "channel") {
          const id = it.id?.channelId;
          return `${i + 1}. ${sn.title} — ${sn.description?.slice(0, 100) ?? ""} (channel id: ${id})`;
        }
        if (type === "playlist") {
          const id = it.id?.playlistId;
          return `${i + 1}. ${sn.title} by ${sn.channelTitle} (playlist id: ${id})`;
        }
        const id = it.id?.videoId;
        return `${i + 1}. ${sn.title} by ${sn.channelTitle} (${fmtDate(sn.publishedAt)}) ${videoUrl(id)}`;
      });

      return {
        content:
          `YouTube ${type} search: "${input.query}" (${items.length} results)\n\n` +
          lines.join("\n") +
          (type === "video"
            ? "\n\nTip: pass these URLs/IDs to youtube_video for full stats."
            : ""),
        isError: false,
      };
    } catch (err: any) {
      return { content: String(err?.message ?? err), isError: true };
    }
  },
};

export default tool;
