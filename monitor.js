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

  // Scroll through the full page to trigger lazy-loaded images
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const distance = 400
      const interval = setInterval(() => {
        window.scrollBy(0, distance)
        if (window.scrollY + window.innerHeight >= document.body.scrollHeight) {
          clearInterval(interval)
          resolve()
        }
      }, 200)
    })
  })

  // Wait for lazy-loaded images to finish loading after scroll
  await page.waitForLoadState("networkidle")

  const issues = await page.evaluate(() => {
    const seen = new Set()
    const results = []

    const cards = document.querySelectorAll("a[href^='/homes/']")

    cards.forEach((card) => {
      // Deduplicate — same property can appear in multiple sections
      const href = card.href
      if (seen.has(href)) return
      seen.add(href)

      const nameEl = card.querySelector("h2, h3")
      const property = nameEl?.textContent?.trim() || href.split("/homes/")[1] || "Unknown"

      const img = card.querySelector("img")

      if (!img) {
        results.push({ property, issue: "No image element" })
        return
      }

      if (!img.src || img.src === window.location.href) {
        results.push({ property, issue: "Image has no src" })
      } else if (img.naturalWidth === 0) {
        results.push({ property, issue: "Image failed to load" })
      }
    })

    return results
  })

  await browser.close()

  console.log(`Found ${issues.length} issue(s)`)
  issues.forEach((i) => console.log(`  - ${i.property}: ${i.issue}`))

  if (issues.length > 0) {
    await postToSlack(issues)
    console.log("Slack alert sent.")
  } else {
    console.log("All images OK — no alert sent.")
  }
}

run().catch((err) => {
  console.error("Monitor failed:", err)
  process.exit(1)
})
