import type { ToolDefinition } from "@vellumai/plugin-api";
import { ytFetch, parseVideoId, fmtCount, fmtDuration, fmtDate, videoUrl } from "../src/yt";

const tool: ToolDefinition = {
  description:
    "Get full details and statistics for one or more YouTube videos: title, channel, " +
    "views, likes, comments, duration, publish date, tags, and description. Accepts " +
    "video IDs or any YouTube URL (watch, youtu.be, shorts). Use when the user asks " +
    "how a video is performing, pastes a YouTube link, or wants to compare videos. " +
    "Cheap (1 quota unit) — prefer this over youtube_search when IDs are known.",
  input_schema: {
    type: "object",
    properties: {
      videos: {
        type: "array",
        items: { type: "string" },
        description: "Up to 25 video IDs or YouTube URLs.",
      },
      includeDescription: {
        type: "boolean",
        description: "Include full description and tags. Default: false (compact stats only).",
      },
    },
    required: ["videos"],
  },
  defaultRiskLevel: "low",
  execute: async (input: any, ctx) => {
    try {
      const raw: string[] = Array.isArray(input.videos) ? input.videos : [input.videos];
      const ids = raw.map((v) => parseVideoId(String(v))).filter(Boolean) as string[];
      const bad = raw.filter((v) => !parseVideoId(String(v)));
      if (ids.length === 0) {
        return {
          content: `Could not extract a video ID from: ${raw.join(", ")}`,
          isError: true,
        };
      }

      const data = await ytFetch(
        "videos",
        {
          part: "snippet,statistics,contentDetails",
          id: ids.slice(0, 25).join(","),
        },
        ctx,
      );

      const items: any[] = data.items ?? [];
      if (items.length === 0) {
        return { content: "No videos found for those IDs (deleted or private?).", isError: false };
      }

      const blocks = items.map((v) => {
        const s = v.statistics ?? {};
        const sn = v.snippet ?? {};
        const views = Number(s.viewCount ?? 0);
        const likes = Number(s.likeCount ?? 0);
        const comments = Number(s.commentCount ?? 0);
        const likeRate = views > 0 ? ((likes / views) * 100).toFixed(2) : "0";
        const commentRate = views > 0 ? ((comments / views) * 100).toFixed(3) : "0";
        let block =
          `## ${sn.title}\n` +
          `- Channel: ${sn.channelTitle} (${sn.channelId})\n` +
          `- Published: ${fmtDate(sn.publishedAt)} | Duration: ${fmtDuration(v.contentDetails?.duration)}\n` +
          `- Views: ${fmtCount(views)} | Likes: ${fmtCount(likes)} (${likeRate}% of views) | ` +
          `Comments: ${fmtCount(comments)} (${commentRate}% of views)\n` +
          `- URL: ${videoUrl(v.id)}`;
        if (input.includeDescription) {
          if (sn.tags?.length) block += `\n- Tags: ${sn.tags.slice(0, 20).join(", ")}`;
          block += `\n- Description:\n${(sn.description ?? "").slice(0, 1500)}`;
        }
        return block;
      });

      let content = blocks.join("\n\n");
      if (bad.length > 0) content += `\n\n(Skipped, not parseable as videos: ${bad.join(", ")})`;
      return { content, isError: false };
    } catch (err: any) {
      return { content: String(err?.message ?? err), isError: true };
    }
  },
};

export default tool;
