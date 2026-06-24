// Visits flent.in/homes with a headless browser and checks every property
// card for missing or broken images. Posts to Slack only when issues are found.

const { chromium } = require("playwright")

const SLACK_WEBHOOK = process.env.SLACK_MONITOR_WEBHOOK
const SITE_URL = "https://flent.in"

async function postToSlack(issues) {
  const lines = issues.map((i) => `Website Monitoring Agent - ${i.property} - image missing`)
  const text = lines.join("\n")

  const res = await fetch(SLACK_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`Slack post failed: ${res.status}`)
}

async function run() {
  if (!SLACK_WEBHOOK) throw new Error("SLACK_MONITOR_WEBHOOK is not set")

  const browser = await chromium.launch()
  const page = await browser.newPage()

  console.log(`Visiting ${SITE_URL}/homes ...`)
  await page.goto(`${SITE_URL}/homes`, { waitUntil: "networkidle" })

  // Find all property cards and check their images
  const issues = await page.evaluate(() => {
    const results = []

    // Property cards are identified by the link wrapping the card
    // Each card has a property name and an image
    const cards = document.querySelectorAll("a[href^='/homes/']")

    cards.forEach((card) => {
      // Get property name from card text
      const nameEl = card.querySelector("h2, h3, [class*='name'], [class*='title']")
      const property = nameEl?.textContent?.trim() || card.href.split("/homes/")[1] || "Unknown"

      const img = card.querySelector("img")

      if (!img) {
        results.push({ property, issue: "No image element found in card" })
        return
      }

      // naturalWidth === 0 means the image failed to load or has no src
      if (!img.src || img.src === window.location.href) {
        results.push({ property, issue: "Image has no src" })
      } else if (img.naturalWidth === 0) {
        results.push({ property, issue: `Image failed to load (${img.src})` })
      }
    })

    return results
  })

  await browser.close()

  console.log(`Checked ${issues.length === 0 ? "all cards — no issues found" : `${issues.length} issue(s):`}`)
  issues.forEach((i) => console.log(`  - ${i.property}: ${i.issue}`))

  if (issues.length > 0) {
    await postToSlack(issues)
    console.log("Slack alert sent.")
  } else {
    console.log("No alert sent.")
  }
}

run().catch((err) => {
  console.error("Monitor failed:", err)
  process.exit(1)
})
