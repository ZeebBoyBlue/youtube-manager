import type { ToolDefinition } from "@vellumai/plugin-api";
import { ytFetch, parseVideoId, fmtCount, fmtDate } from "../src/yt";

const tool: ToolDefinition = {
  description:
    "Read top-level comments on a YouTube video, ordered by relevance or recency, with " +
    "like counts and reply counts. Accepts a video ID or URL. Use when the user wants to " +
    "know what viewers are saying, mine comments for content ideas or sentiment, or find " +
    "the top comments on a video.",
  input_schema: {
    type: "object",
    properties: {
      video: { type: "string", description: "Video ID or YouTube URL." },
      order: {
        type: "string",
        enum: ["relevance", "time"],
        description: "relevance = top comments, time = newest first. Default: relevance.",
      },
      maxResults: {
        type: "number",
        description: "Number of comment threads, 1-50. Default: 20.",
      },
      searchTerms: {
        type: "string",
        description: "Only return comments containing these terms. Optional.",
      },
    },
    required: ["video"],
  },
  defaultRiskLevel: "low",
  execute: async (input: any, ctx) => {
    try {
      const id = parseVideoId(String(input.video));
      if (!id) {
        return { content: `Could not parse a video ID from "${input.video}".`, isError: true };
      }
      const data = await ytFetch(
        "commentThreads",
        {
          part: "snippet",
          videoId: id,
          order: input.order ?? "relevance",
          maxResults: Math.min(Math.max(Number(input.maxResults ?? 20), 1), 50),
          searchTerms: input.searchTerms,
          textFormat: "plainText",
        },
        ctx,
      );

      const items: any[] = data.items ?? [];
      if (items.length === 0) {
        return { content: "No comments found (comments may be disabled).", isError: false };
      }

      const lines = items.map((t, i) => {
        const c = t.snippet?.topLevelComment?.snippet ?? {};
        const replies = t.snippet?.totalReplyCount ?? 0;
        const text = String(c.textDisplay ?? "").replace(/\s+/g, " ").slice(0, 400);
        return (
          `${i + 1}. [${fmtCount(c.likeCount)} likes, ${replies} replies] ` +
          `${c.authorDisplayName} (${fmtDate(c.publishedAt)}): ${text}`
        );
      });

      return {
        content: `Comments on video ${id} (${items.length} threads, order: ${input.order ?? "relevance"})\n\n${lines.join("\n")}`,
        isError: false,
      };
    } catch (err: any) {
      return { content: String(err?.message ?? err), isError: true };
    }
  },
};

export default tool;
