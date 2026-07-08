import type { ToolDefinition } from "@vellumai/plugin-api";
import { ytFetch, fmtVideoLine } from "../src/yt";

const tool: ToolDefinition = {
  description:
    "List the videos in a YouTube playlist with per-video stats (views, likes, duration). " +
    "Accepts a playlist ID (PL.../UU...) or playlist URL. Use when the user shares a " +
    "playlist, wants to audit a series, or wants deeper channel history than " +
    "youtube_channel's recent uploads (pass a channel's uploads playlist UU... id).",
  input_schema: {
    type: "object",
    properties: {
      playlist: { type: "string", description: "Playlist ID or playlist URL." },
      maxResults: {
        type: "number",
        description: "Number of videos, 1-50. Default: 25.",
      },
      page: {
        type: "string",
        description: "Page token from a previous call to fetch the next page. Optional.",
      },
    },
    required: ["playlist"],
  },
  defaultRiskLevel: "low",
  execute: async (input: any, ctx) => {
    try {
      let playlistId = String(input.playlist).trim();
      try {
        const u = new URL(playlistId.startsWith("http") ? playlistId : `https://${playlistId}`);
        if (u.searchParams.get("list")) playlistId = u.searchParams.get("list")!;
      } catch {
        /* bare ID */
      }

      const pl = await ytFetch(
        "playlistItems",
        {
          part: "contentDetails,snippet",
          playlistId,
          maxResults: Math.min(Math.max(Number(input.maxResults ?? 25), 1), 50),
          pageToken: input.page,
        },
        ctx,
      );

      const items: any[] = pl.items ?? [];
      if (items.length === 0) {
        return { content: "Playlist is empty or not found.", isError: false };
      }

      const ids = items.map((it) => it.contentDetails?.videoId).filter(Boolean);
      const vids = await ytFetch(
        "videos",
        { part: "snippet,statistics,contentDetails", id: ids.join(",") },
        ctx,
      );
      const byId = new Map((vids.items ?? []).map((v: any) => [v.id, v]));

      const lines = items.map((it, i) => {
        const v = byId.get(it.contentDetails?.videoId);
        if (!v) return `${i + 1}. ${it.snippet?.title} (unavailable)`;
        return `${i + 1}. ${fmtVideoLine(v)}`;
      });

      let content =
        `Playlist ${playlistId} — ${pl.pageInfo?.totalResults ?? items.length} videos total\n\n` +
        lines.join("\n");
      if (pl.nextPageToken) {
        content += `\n\nNext page token: ${pl.nextPageToken} (pass as 'page' to continue)`;
      }
      return { content, isError: false };
    } catch (err: any) {
      return { content: String(err?.message ?? err), isError: true };
    }
  },
};

export default tool;
