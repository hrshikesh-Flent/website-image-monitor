// Fetches all active Flent properties from Webflow and checks their card images.
// Posts to Slack only when missing or broken images are found.
// Run via GitHub Actions on a schedule, or locally:
//   WEBFLOW_API_TOKEN=... SLACK_MONITOR_WEBHOOK=... node monitor.js

const WEBFLOW_API_TOKEN = process.env.WEBFLOW_API_TOKEN
const SLACK_WEBHOOK = process.env.SLACK_MONITOR_WEBHOOK
const PROPERTIES_COLLECTION = "6593ed11d5ad65d107dfe7af"
const SITE_URL = "https://flent.in"

async function fetchProperties() {
  let all = []
  let offset = 0
  const limit = 100

  while (true) {
    const res = await fetch(
      `https://api.webflow.com/v2/collections/${PROPERTIES_COLLECTION}/items?limit=${limit}&offset=${offset}`,
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
        },
      },
    )
    if (!res.ok) throw new Error(`Webflow API error: ${res.status} ${res.statusText}`)
    const data = await res.json()
    all = all.concat(data.items ?? [])
    if (all.length >= (data.pagination?.total ?? 0)) break
    offset += limit
  }

  return all
}

async function checkUrl(url) {
  try {
    const res = await fetch(url, { method: "HEAD" })
    return res.ok
  } catch {
    return false
  }
}

async function postToSlack(issues, checked) {
  const lines = issues.map(
    (i) => `• *${i.property}* — ${i.issue} (<${SITE_URL}/homes/${i.slug}|view>)`,
  )
  const text = [
    `🚨 *Flent Website — Missing Images Detected*`,
    ``,
    ...lines,
    ``,
    `_${issues.length} issue${issues.length !== 1 ? "s" : ""} found across ${checked} active properties._`,
  ].join("\n")

  const res = await fetch(SLACK_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`Slack post failed: ${res.status}`)
}

async function run() {
  if (!WEBFLOW_API_TOKEN) throw new Error("WEBFLOW_API_TOKEN is not set")
  if (!SLACK_WEBHOOK) throw new Error("SLACK_MONITOR_WEBHOOK is not set")

  console.log("Fetching properties from Webflow...")
  const properties = await fetchProperties()

  const active = properties.filter(
    (p) => !p.isArchived && !p.isDraft && p.fieldData?.Active,
  )
  console.log(`Checking ${active.length} active properties...`)

  const issues = []

  await Promise.all(
    active.map(async (p) => {
      const name = p.fieldData?.name
      const slug = p.fieldData?.slug
      const thumbnail = p.fieldData?.["property-thumbnail"]
      const featured = p.fieldData?.["property-featured-photo"]

      if (!thumbnail?.url && !featured?.url) {
        issues.push({ property: name, slug, issue: "No card image set (thumbnail and featured photo both missing)" })
        return
      }

      if (thumbnail?.url) {
        const ok = await checkUrl(thumbnail.url)
        if (!ok) issues.push({ property: name, slug, issue: `Thumbnail URL broken: ${thumbnail.url}` })
      }

      if (featured?.url) {
        const ok = await checkUrl(featured.url)
        if (!ok) issues.push({ property: name, slug, issue: `Featured photo URL broken: ${featured.url}` })
      }
    }),
  )

  if (issues.length > 0) {
    console.log(`Found ${issues.length} issue(s) — posting to Slack...`)
    issues.forEach((i) => console.log(`  - ${i.property}: ${i.issue}`))
    await postToSlack(issues, active.length)
    console.log("Slack alert sent.")
  } else {
    console.log("All images OK. No alert sent.")
  }
}

run().catch((err) => {
  console.error("Monitor failed:", err)
  process.exit(1)
})
