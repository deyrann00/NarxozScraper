---
description: Email the Narxoz 2GIS report (negative / neutral / positive, irrelevant filtered out)
---

Send the review report by email. Only send when the user asked for it in this message.

1. If the user named recipients or a period, pass them as `to` (array) and `hours`.
   Otherwise call `send_narxoz_2gis_report` with no arguments (config `email.to`, 7 days).
2. If the result says reviews are `not_analyzed`, call `analyze_narxoz_2gis` first and send again.
3. On success, report who it went to and the counts (relevant, negative, neutral, positive,
   irrelevant). On an error about missing settings, repeat the list from the error and how to
   fix it: `email.to` in config.json, `SMTP_USER` / `SMTP_PASS` environment variables.

$ARGUMENTS
