import type { ToolDefinition } from "@vellumai/plugin-api";
import {
  ytFetch,
  parseChannelRef,
  fetchChannel,
  fmtCount,
  fmtVideoLine,
  loadWatchlist,
  saveWatchlist,
} from "../src/yt";

const tool: ToolDefinition = {
  description:
    "Manage a persistent watchlist of YouTube channels and run digests over it. Actions: " +
    "'add' a channel (ID, @handle, or URL), 'remove' one, 'list' tracked channels with " +
    "current subscriber counts, and 'digest' — fetch every tracked channel's uploads since " +
    "the last digest with stats. Use when the user wants to track channels, monitor " +
    "competitors on YouTube, or asks what tracked channels have posted lately.",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["add", "remove", "list", "digest"],
        description: "What to do.",
      },
      channel: {
        type: "string",
        description: "Channel ID, @handle, or URL. Required for add/remove.",
      },
    },
    required: ["action"],
  },
  defaultRiskLevel: "low",
  execute: async (input: any, ctx) => {
    try {
      const action = String(input.action);
      const state = await loadWatchlist(ctx.workingDir);

      if (action === "add") {
        const ref = parseChannelRef(String(input.channel ?? ""));
        if (!ref) return { content: "Provide a channel ID, @handle, or URL to add.", isError: true };
        const ch = await fetchChannel(ref, ctx);
        if (!ch) return { content: `No channel found for "${input.channel}".`, isError: true };
        if (state.channels.some((c) => c.channelId === ch.id)) {
          return { content: `${ch.snippet?.title} is already on the watchlist.`, isError: false };
        }
        state.channels.push({
          channelId: ch.id,
          title: ch.snippet?.title ?? ch.id,
          handle: ch.snippet?.customUrl,
          uploadsPlaylistId: ch.contentDetails?.relatedPlaylists?.uploads ?? "",
          subscriberCount: ch.statistics?.subscriberCount,
          addedAt: new Date().toISOString(),
          lastCheckedAt: new Date().toISOString(),
        });
        await saveWatchlist(ctx.workingDir, state);
        return {
          content: `Added ${ch.snippet?.title} (${fmtCount(ch.statistics?.subscriberCount)} subs) to the watchlist. Now tracking ${state.channels.length} channel(s).`,
          isError: false,
        };
      }

      if (action === "remove") {
        const ref = parseChannelRef(String(input.channel ?? ""));
        const before = state.channels.length;
        state.channels = state.channels.filter(
          (c) =>
            c.channelId !== ref?.id &&
            c.handle?.toLowerCase() !== ref?.handle?.toLowerCase() &&
            c.title.toLowerCase() !== String(input.channel ?? "").toLowerCase(),
        );
        if (state.channels.length === before) {
          return { content: `"${input.channel}" is not on the watchlist.`, isError: false };
        }
        await saveWatchlist(ctx.workingDir, state);
        return { content: `Removed. ${state.channels.length} channel(s) remain.`, isError: false };
      }

      if (action === "list") {
        if (state.channels.length === 0) {
          return { content: "Watchlist is empty. Use action 'add' to track a channel.", isError: false };
        }
        // Refresh subscriber counts in one batch call.
        const data = await ytFetch(
          "channels",
          { part: "statistics", id: state.channels.map((c) => c.channelId).join(",") },
          ctx,
        );
        const subs = new Map<string, string | undefined>(
          (data.items ?? []).map((c: any) => [c.id, c.statistics?.subscriberCount]),
        );
        const lines = state.channels.map((c, i) => {
          const now = subs.get(c.channelId);
          const delta =
            now && c.subscriberCount
              ? Number(now) - Number(c.subscriberCount)
              : 0;
          const deltaStr = delta !== 0 ? ` (${delta > 0 ? "+" : ""}${fmtCount(Math.abs(delta))} since added)` : "";
          return `${i + 1}. ${c.title} ${c.handle ?? ""} — ${fmtCount(now ?? c.subscriberCount)} subs${deltaStr} [${c.channelId}]`;
        });
        return { content: `Watchlist (${state.channels.length} channels)\n\n${lines.join("\n")}`, isError: false };
      }

      if (action === "digest") {
        if (state.channels.length === 0) {
          return { content: "Watchlist is empty — nothing to digest. Add channels first.", isError: false };
        }
        const sections: string[] = [];
        for (const c of state.channels) {
          if (ctx.signal?.aborted) break;
          const since = c.lastCheckedAt ? new Date(c.lastCheckedAt) : new Date(0);
          const pl = await ytFetch(
            "playlistItems",
            { part: "contentDetails,snippet", playlistId: c.uploadsPlaylistId, maxResults: 10 },
            ctx,
          );
          const fresh = (pl.items ?? []).filter(
            (it: any) => new Date(it.contentDetails?.videoPublishedAt ?? 0) > since,
          );
          if (fresh.length === 0) {
            sections.push(`## ${c.title}\nNo new uploads since ${since.toISOString().slice(0, 10)}.`);
          } else {
            const ids = fresh.map((it: any) => it.contentDetails?.videoId).filter(Boolean);
            const vids = await ytFetch(
              "videos",
              { part: "snippet,statistics,contentDetails", id: ids.join(",") },
              ctx,
            );
            const lines = (vids.items ?? []).map((v: any) => `- ${fmtVideoLine(v)}`);
            sections.push(`## ${c.title} — ${fresh.length} new upload(s)\n${lines.join("\n")}`);
          }
          c.lastCheckedAt = new Date().toISOString();
        }
        await saveWatchlist(ctx.workingDir, state);
        return {
          content: `YouTube watchlist digest (${new Date().toISOString().slice(0, 10)})\n\n${sections.join("\n\n")}`,
          isError: false,
        };
      }

      return { content: `Unknown action "${action}". Use add, remove, list, or digest.`, isError: true };
    } catch (err: any) {
      return { content: String(err?.message ?? err), isError: true };
    }
  },
};

export default tool;
