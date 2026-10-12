---
description: Summarise already-collected Narxoz 2GIS reviews without scraping
---

Read the saved archive only — do not scrape.

Call `latest_narxoz_2gis` (`hours: 168` unless the user asks for another window;
`hours: 0` for the full archive; `max_rating: 3` when they only want complaints) and
summarise the results. Irrelevant reviews (spam, empty, not about Narxoz) are already
filtered out. Group by sentiment — negative first, then neutral, then positive (the
`sentiment` field; `max_rating` is no longer needed for complaints) — and inside each
group by branch: author, date, stars, link, `summary` (or your own one-line gist), `topics`,
then the number of replies (`replies_count`) and the replies themselves (`replies`, oldest
first; `from_org` marks Narxoz's own). Finish with the recurring topics among the negative
ones and which complaints have no answer from Narxoz. If nothing is saved yet, say so and suggest `/narxoz-2gis:scrape`.

$ARGUMENTS
