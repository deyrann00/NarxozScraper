---
description: Open the HTML dashboard of collected Narxoz 2GIS reviews in the browser
---

Read the saved archive only — do not scrape.

Call `view_narxoz_2gis`. It rebuilds `data/index.html` from the archive and opens it in
the default browser. Tell the user the file path it returned and that the page filters by
period, branch, rating and text. If the archive is empty, suggest `/narxoz-2gis:scrape`.

$ARGUMENTS
