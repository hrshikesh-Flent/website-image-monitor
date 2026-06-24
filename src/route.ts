import { type NextRequest, NextResponse } from "next/server"
import { getCollectionItems, COLLECTIONS } from "@/lib/webflow"
import type { Property } from "@/lib/webflow"

// Checks all active property card images every 6 hours (Vercel cron).
// Posts a Slack alert if any image is missing or returns a non-200 response.
// Env vars required:
//   SLACK_MONITOR_WEBHOOK — Slack incoming webhook URL
//   CRON_SECRET           — injected automatically by Vercel for cron requests

const SLACK_WEBHOOK = process.env.SLACK_MONITOR_WEBHOOK
const SITE_URL = "https://flent.in"

type ImageIssue = {
  property: string
  slug: string
  issue: string
}

async function checkUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" })
    return res.ok
  } catch {
    return false
  }
}

async function postToSlack(issues: ImageIssue[], checked: number): Promise<void> {
  if (!SLACK_WEBHOOK) {
    console.error("[image-monitor] SLACK_MONITOR_WEBHOOK is not set")
    return
  }
  const lines = issues.map(
    (i) => `• *${i.property}* — ${i.issue} (<${SITE_URL}/homes/${i.slug}|view page>)`,
  )
  await fetch(SLACK_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: [
        `🚨 *Flent Website — Missing Images Detected*`,
        ``,
        ...lines,
        ``,
        `_${issues.length} issue${issues.length !== 1 ? "s" : ""} found across ${checked} active properties._`,
      ].join("\n"),
    }),
  })
}

export async function GET(req: NextRequest) {
  // Vercel injects CRON_SECRET on scheduled invocations. Reject anything else.
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get("authorization")
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  let properties: Property[]
  try {
    properties = await getCollectionItems<Property>(COLLECTIONS.PROPERTIES)
  } catch (err) {
    console.error("[image-monitor] Failed to fetch properties from Webflow", err)
    return NextResponse.json({ error: "Failed to fetch properties" }, { status: 500 })
  }

  // Only check active, published properties — the ones that show up on property cards.
  const active = properties.filter((p) => !p.isArchived && !p.isDraft && p.fieldData.Active)

  const issues: ImageIssue[] = []

  await Promise.all(
    active.map(async (p) => {
      const name = p.fieldData.name
      const slug = p.fieldData.slug
      const thumbnail = p.fieldData["property-thumbnail"]
      const featured = p.fieldData["property-featured-photo"]

      // Both image fields are missing — card will render blank.
      if (!thumbnail?.url && !featured?.url) {
        issues.push({
          property: name,
          slug,
          issue: "No card image set (thumbnail and featured photo are both missing)",
        })
        return
      }

      // Thumbnail URL exists — verify it's reachable.
      if (thumbnail?.url) {
        const ok = await checkUrl(thumbnail.url)
        if (!ok)
          issues.push({
            property: name,
            slug,
            issue: `Thumbnail URL broken (${thumbnail.url})`,
          })
      }

      // Featured photo URL exists — verify it's reachable.
      if (featured?.url) {
        const ok = await checkUrl(featured.url)
        if (!ok)
          issues.push({
            property: name,
            slug,
            issue: `Featured photo URL broken (${featured.url})`,
          })
      }
    }),
  )

  if (issues.length > 0) {
    await postToSlack(issues, active.length)
  }

  return NextResponse.json({
    ok: true,
    checked: active.length,
    issues: issues.length,
    details: issues,
  })
}
