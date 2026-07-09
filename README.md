# youtube-manager

YouTube manager plugin for Vellum. Search, video/channel analytics, comment
mining, trending research, and a persistent channel watchlist with digests —
all through the YouTube Data API v3.

## Tools

| Tool                | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `youtube_search`    | Search videos/channels/playlists (order, date, channel filters)     |
| `youtube_video`     | Full stats for one or more videos (accepts URLs), engagement rates  |
| `youtube_channel`   | Channel overview + recent uploads with per-video stats              |
| `youtube_playlist`  | List playlist videos with stats (paginated)                         |
| `youtube_comments`  | Top or newest comments on a video, with like/reply counts           |
| `youtube_trending`  | Most popular videos by region and category                          |
| `youtube_watchlist` | Track channels; `digest` pulls new uploads since last check         |

Plus a `youtube-manager` skill with report workflows (performance breakdowns,
competitor snapshots, digests, idea mining).

## Setup

Two auth paths, tried in this order:

### Option A: Managed OAuth (recommended, no Google Cloud project needed)

If your assistant has the managed Google integration, add the YouTube read
scope to your connection:

```
assistant oauth connect google --scopes \
  <your current google scopes> \
  https://www.googleapis.com/auth/youtube.readonly
```

(Include your existing scopes — Gmail, Calendar, Drive — so the re-consent
doesn't drop them. `assistant oauth providers get google` lists the defaults.)
All tools route through `assistant oauth request` automatically once the scope
is present. No API key, no quota project of your own.

### Option B: API key

A YouTube Data API v3 key (free, 10,000 quota units/day):

1. [Google Cloud Console](https://console.cloud.google.com) → enable
   **YouTube Data API v3** → Credentials → Create API key.
2. Provide it one of two ways:
   - `YOUTUBE_API_KEY` environment variable, or
   - the encrypted credential vault:
     `assistant credentials prompt --service youtube --field api_key`

API keys are never stored in the workspace (workspace files end up in
backups/sync). A legacy `plugins-data/youtube-manager/credentials.json` from
older versions is migrated into the vault automatically and deleted.

The client checks OAuth first and falls back to the API key, so shipping both
is fine.

## Scope

Public reads only. Uploading, editing metadata, replying to comments, and
private channel analytics (CTR, watch time) require OAuth and are not included
in this version.

## Data

Runtime state lives in `<workspace>/plugins-data/youtube-manager/`:
`watchlist.json` (tracked channels). No secrets are stored there — the API
key lives in the encrypted credential vault.
