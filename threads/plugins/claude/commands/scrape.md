---
description: Scrape Threads for new Narxoz mentions and summarise the last 7 days
---

Collect fresh Threads mentions of Narxoz University.

1. Call `scrape_narxoz_threads`.
2. If it reports a login wall, call `login_narxoz_threads` once and retry.
3. Call `latest_narxoz_threads` with `hours: 168`, then again with `hours: 24` if the weekly set is non-empty.

Report the last 7 days first, then call out anything from the last 24 hours. For each
post give the author, the date, the link, and a one-line gist. Show replies together with
the parent post they answer. Drop false positives where "наркоз" (anesthesia) was matched
as "нархоз".

$ARGUMENTS
