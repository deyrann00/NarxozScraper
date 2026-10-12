---
description: Check the Narxoz Threads plugin install and save a Threads login session
---

Get this machine ready to scrape.

1. Call `narxoz_threads_status`.
2. Report `data_root` — that is where posts, config and the session are stored.
3. If neither `has_api_token` nor `has_login_credentials` is true, tell the user to create
   a `.env` next to `data_root` (the first entry in `env_files`) containing either:

   ```
   THREADS_USERNAME=...
   THREADS_PASSWORD=...
   ```

   or `THREADS_ACCESS_TOKEN=...` for the official API. Do not ask them to paste
   credentials into the chat — they edit the file themselves.
4. Once credentials exist and `has_saved_session` is false, call `login_narxoz_threads`.
   It opens a real browser window; tell the user to finish any 2FA prompt there.
5. Finish by saying they can now run `/narxoz-threads:scrape`.

$ARGUMENTS
