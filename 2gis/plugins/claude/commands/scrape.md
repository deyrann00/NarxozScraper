---
description: Collect new 2GIS reviews of Narxoz branches and summarise the last 7 days
---

Collect fresh 2GIS reviews of Narxoz University.

1. Call `scrape_narxoz_2gis`.
2. Call `latest_narxoz_2gis` with `hours: 168`, then again with `hours: 24` if the weekly set is non-empty.

Start with one line per branch from the scrape summary: name, address, rating, total
review count, then the `analysis` block of the summary (model, relevant / irrelevant,
negative / neutral / positive). Then report the last 7 days grouped by sentiment —
negative first — and by branch inside, and call out anything from the last 24 hours.
Irrelevant reviews are already left out. For each review give the author, the date, the
stars, the link, the `summary` and `topics`, then the number of replies (`replies_count`)
and the replies themselves (`replies`, oldest first; `from_org` marks Narxoz's own). Name
the recurring complaints. If the summary's errors say the LLM key is missing, mention that
sentiment came from star ratings and that setting `OPENROUTER_API_KEY` enables real analysis.

If the week is empty, say so and offer `/narxoz-2gis:report` for the saved archive.

$ARGUMENTS
