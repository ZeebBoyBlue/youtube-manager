---
name: youtube-manager
description: >-
  Workflows for managing and researching YouTube with the youtube_* tools:
  competitor channel digests, video performance breakdowns, comment mining for
  content ideas, and trending research. Use when the user asks for a YouTube
  report, competitor analysis, video performance review, comment sentiment, or
  content ideas from YouTube.
metadata:
  emoji: "📺"
  vellum:
    display-name: "YouTube Manager"
    category: "productivity"
    activation-hints:
      - "User asks how a YouTube video or channel is performing"
      - "User wants to track or monitor YouTube channels or competitors"
      - "User wants content ideas from YouTube comments or trending videos"
      - "User asks for a YouTube digest or report"
    avoid-when:
      - "User wants to upload or edit videos (requires OAuth, not supported)"
      - "User asks about YouTube ads or monetization dashboards"
---

You have seven `youtube_*` tools backed by the YouTube Data API v3. All are public
reads. Quota is 10,000 units/day: `youtube_search` costs 100 units per call,
everything else costs ~1-3. Prefer ID-based lookups over search whenever an ID
or URL is already known.

## Setup

If any tool returns "YouTube access is not set up", prefer the managed OAuth
path: check current Google scopes with `assistant oauth providers get google`
and `assistant oauth status google`, then reconnect with the existing scopes
plus `https://www.googleapis.com/auth/youtube.readonly`. Show the user an
`oauth_connect`-style CTA or the connect URL — never make them paste secrets
in chat. Fallback: an API key created in Google Cloud Console with YouTube Data API
v3 enabled, provided via `YOUTUBE_API_KEY` or stored in the encrypted vault
with `assistant credentials prompt --service youtube --field api_key` (the
prompt flow collects it through a secure UI). Never store keys in workspace
files and never echo keys back into the conversation.

## Workflows

### Video performance breakdown

1. `youtube_video` with `includeDescription: true` for the target video(s).
2. `youtube_comments` (order: relevance, ~20 threads) for audience reaction.
3. Report: views, like rate and comment rate (already computed as % of views),
   standout comment themes, and one concrete takeaway. Benchmark: like rate
   above ~4% of views is strong; comment rate above ~0.5% signals high engagement.

### Competitor channel snapshot

1. `youtube_channel` with `recentUploads: 15`.
2. Identify outliers: uploads whose views are well above the channel's typical
   recent range. Those titles/formats are what's working — name the pattern.
3. For deeper history, pass the channel's uploads playlist (UU + channel ID
   without the UC prefix) to `youtube_playlist`.

### Watchlist digest

1. `youtube_watchlist` action `list` to show what's tracked.
2. Action `digest` to pull all uploads since the last digest with stats.
3. Summarize per channel: cadence, standout video, and anything the user's own
   content strategy should react to. Keep it tight — top signal first.

### Idea mining

1. `youtube_trending` (pick the relevant category) and/or `youtube_search`
   ordered by viewCount with a `publishedAfter` in the last 30-90 days.
2. `youtube_comments` on the top performers — unanswered questions and repeated
   complaints in comments are content gaps.
3. Deliver ideas as: angle, why it will work (evidence from the data), format.

## Limits

- No OAuth: cannot upload, edit metadata, reply to comments, or read private
  analytics (impressions, CTR, watch time). If asked, say so and offer the
  public-stats equivalent.
- Subscriber counts are rounded by the API for most channels.
- `youtube_search` results lack stats; follow up with `youtube_video` for numbers.
