# website-image-monitor

Vercel cron function that checks all active Flent property card images every 6 hours and posts a Slack alert when any image is missing or broken.

## How it works

1. Fetches all active properties from Webflow CMS
2. Checks each property's `property-thumbnail` and `property-featured-photo` URLs
3. Flags images that are missing entirely or return a non-200 HTTP response
4. Posts to Slack only when issues are found — no noise on clean runs

## Environment variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_WEBFLOW_API_TOKEN` | Webflow API token |
| `SLACK_MONITOR_WEBHOOK` | Slack incoming webhook URL |
| `CRON_SECRET` | Injected automatically by Vercel on Pro plans |

## Cron schedule

Runs every 6 hours via `vercel.json`:
```json
{
  "crons": [{ "path": "/api/monitor/images", "schedule": "0 */6 * * *" }]
}
```

## Slack alert format

```
🚨 Flent Website — Missing Images Detected

• Hadley — No card image set (thumbnail and featured photo are both missing) (view page)

1 issue found across 12 active properties.
```
