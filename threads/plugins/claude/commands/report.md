---
description: Summarise already-collected Narxoz Threads posts without scraping
---

Read the saved archive only — do not scrape.

Call `latest_narxoz_threads` (`hours: 168` unless the user asks for another window;
`hours: 0` for the full archive) and summarise the results: author, date, link, one-line
gist, replies grouped with their parent. Note the overall sentiment and any recurring
topic. If nothing is saved yet, say so and suggest `/narxoz-threads:scrape`.

$ARGUMENTS
