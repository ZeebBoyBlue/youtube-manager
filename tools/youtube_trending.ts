import type { ToolDefinition } from "@vellumai/plugin-api";
import { ytFetch, fmtVideoLine } from "../src/yt";

// Common category IDs (YouTube Data API videoCategoryId)
const CATEGORIES: Record<string, string> = {
  film: "1",
  autos: "2",
  music: "10",
  pets: "15",
  sports: "17",
  gaming: "20",
  people: "22",
  comedy: "23",
  entertainment: "24",
  news: "25",
  howto: "26",
  education: "27",
  science: "28",
  tech: "28",
};

const tool: ToolDefinition = {
  description:
    "Get the current trending (most popular) videos on YouTube for a region, optionally " +
    "filtered by category (music, gaming, tech/science, news, comedy, education, sports, " +
    "entertainment, howto, film). Use when the user asks what's trending on YouTube, wants " +
    "topical content ideas, or is researching what's popular in a niche right now.",
  input_schema: {
    type: "object",
    properties: {
      region: {
        type: "string",
        description: "Two-letter region code (US, GB, JP, ...). Default: US.",
      },
      category: {
        type: "string",
        description:
          "Optional category: music, gaming, tech, science, news, comedy, education, " +
          "sports, entertainment, howto, film, pets, autos.",
      },
      maxResults: {
        type: "number",
        description: "Number of videos, 1-25. Default: 10.",
      },
    },
    required: [],
  },
  defaultRiskLevel: "low",
  execute: async (input: any, ctx) => {
    try {
      const region = String(input.region ?? "US").toUpperCase();
      const catKey = input.category ? String(input.category).toLowerCase() : undefined;
      const videoCategoryId = catKey ? CATEGORIES[catKey] : undefined;
      if (catKey && !videoCategoryId) {
        return {
          content: `Unknown category "${catKey}". Options: ${Object.keys(CATEGORIES).join(", ")}.`,
          isError: true,
        };
      }

      const data = await ytFetch(
        "videos",
        {
          part: "snippet,statistics,contentDetails",
          chart: "mostPopular",
          regionCode: region,
          videoCategoryId,
          maxResults: Math.min(Math.max(Number(input.maxResults ?? 10), 1), 25),
        },
        ctx,
      );

      const items: any[] = data.items ?? [];
      if (items.length === 0) {
        return { content: `No trending data for region ${region}.`, isError: false };
      }
      const lines = items.map(
        (v, i) => `${i + 1}. ${fmtVideoLine(v)} — ${v.snippet?.channelTitle}`,
      );
      return {
        content:
          `Trending on YouTube (${region}${catKey ? `, ${catKey}` : ""})\n\n` + lines.join("\n"),
        isError: false,
      };
    } catch (err: any) {
      return { content: String(err?.message ?? err), isError: true };
    }
  },
};

export default tool;
