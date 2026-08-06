# Goodreads Sync v3

Automatically downloads books from your Goodreads "to-read" shelf and keeps
looking for ones it hasn't found yet. Runs on a schedule, checks for new
books, searches Anna's Archive, and saves EPUBs to each user's folder on
your NAS. A web dashboard replaces the old console scripts for day-to-day
management.

This is a ground-up rebuild of [goodreads-sync-v2](https://github.com/timoheddes/goodreads-sync-v2),
keeping the same core idea but changing how a few things work. See
"What's different from v2" below.

> **Status:** under active development. This README and the feature set
> will grow phase by phase -- see the project board / commit history for
> where things stand.

## How it works

1. Every ~10 minutes, checks each user's Goodreads "to-read" shelf via RSS
   -- cheaply, by hashing the feed and skipping the full parse when nothing
   has changed since the last check.
2. New books are queued as `pending` in a local SQLite database.
3. For each pending book, searches Anna's Archive (via FlareSolverr to
   bypass Cloudflare) and fuzzy-matches the top results against the
   expected title and author.
4. Downloads the EPUB and copies it into each subscribed user's folder.
5. Books that aren't found yet are retried later on a backoff schedule --
   nothing is ever marked permanently failed, since new titles get added to
   Anna's Archive all the time.
6. Once a day, scans each user's folder for EPUBs that weren't downloaded
   by the sync itself (i.e. added by hand) and reconciles them into the
   database, reading the title/author out of the file's own metadata.
7. Once a day, if there's anything to report, emails each user a short
   digest: books that were found, and books that are still being searched
   for.

## What's different from v2

- **Faster, cheaper shelf checks.** v2 re-fetched and re-diffed every book
  on every cron tick (default hourly). v3 checks every ~10 minutes but
  short-circuits on a feed hash, so an unchanged shelf costs almost
  nothing.
- **No permanent failures.** v2 gave up on a book after 5 attempts. v3
  keeps retrying indefinitely on an exponential backoff, since Anna's
  Archive gains new titles over time.
- **Folder scanning.** Books added to a user's folder by hand are picked up
  automatically and recorded in the database (marked as a manual
  addition), instead of being invisible to the app.
- **Daily digest, not per-cycle emails.** One email a day summarizing
  what's new and what's still missing, only sent if there's something to
  say.
- **Web dashboard.** Manage users, see queue status, retry or remove
  books, and trigger a sync -- no more `docker exec` into the container.
- **No local build on the NAS.** A GitHub Actions workflow builds a
  multi-arch (amd64/arm64) image and publishes it to GHCR on every push.
  Portainer pulls that image directly; the NAS never runs `docker build`,
  which is what caused architecture mismatches in the past.

## Prerequisites

- Docker and Docker Compose (or Portainer)
- An [Anna's Archive](https://annas-archive.li) API key for the fast
  download API
- Your Goodreads user ID (the number in your Goodreads profile URL)

### Finding your Goodreads ID

Go to your Goodreads profile. The URL will look like:

```
https://www.goodreads.com/user/show/104614681-yourname
```

The number (`104614681`) is your Goodreads ID. Make sure your "to-read"
shelf is public so the RSS feed is accessible.

## Deploying via Portainer (GitOps)

1. In Portainer, go to **Stacks -> Add stack**.
2. Choose **Repository** and point it at
   `https://github.com/timoheddes/goodreads-sync-v3`, with
   `docker-compose.yml` as the compose path.
3. Add the environment variables below in the Portainer UI (or via an
   `.env` file referenced by the stack).
4. Enable **GitOps updates** with automatic redeploy, and make sure
   **re-pull image** is on so a new `latest` tag from GHCR actually gets
   picked up, not just compose-file changes.
5. Deploy.

Because `docker-compose.yml` references a pre-built image
(`ghcr.io/timoheddes/goodreads-sync-v3`) rather than building from the
Dockerfile, Portainer never compiles anything -- it just pulls whatever
GitHub Actions most recently published for the host's architecture.

If the GHCR package is private, Portainer will need a registry credential
(a GitHub PAT with `read:packages`) configured under **Registries** --
or simplest, make the package public from its GitHub settings once the
first image has been pushed.

### Environment variables

| Variable         | Default               | Description                                                      |
| ----------------- | ---------------------- | ------------------------------------------------------------------ |
| `AA_API_KEY`      | _(required)_           | Anna's Archive API key                                           |
| `DOWNLOADS_PATH`  | _(required)_           | Host path to mount as `/downloads` (parent of each user's folder) |
| `PUID` / `PGID`   | `1000` / `1000`        | UID/GID the app should run as, matching the owner of your books share |
| `TZ`              | `Europe/Amsterdam`     | Timezone for logs, cron schedules, and the daily digest send time |
| `DASHBOARD_PORT`  | `47291`                | Host port for the dashboard/health check (runs with `network_mode: host`, so this is a real host port -- pick something else if it's taken too) |
| `FOLDER_SCAN_CRON`| `0 3 * * *`            | Cron schedule for the daily folder scan (Phase 2)                |
| `FLARE_URL`       | `http://localhost:8191/v1` | FlareSolverr endpoint                                        |
| `DB_PATH`         | `/app/data/books.db`   | SQLite database path inside the container                       |
| `SMTP_USER`       | _(optional)_           | Gmail address used to send the daily digest                     |
| `SMTP_PASS`       | _(optional)_           | Gmail app password                                               |
| `SMTP_FROM`       | `${SMTP_USER}`         | Sender address for digest emails                                |

`PUID`/`PGID` are what fix the folder-ownership problems v2 had on
Synology -- set them to match the user that owns your `DOWNLOADS_PATH`
share (run `id <user>` over SSH on the NAS).

## Adding users (temporary -- until the Phase 4 dashboard lands)

There's no dashboard yet, so users are added via a small CLI, same idea as
v2's `add-user.sh`:

```bash
docker exec -it book-sync node dist/cli/add-user.js "Alice" "104614681" "/downloads/Alice" "alice@example.com"
docker exec -it book-sync node dist/cli/list-users.js
```

(Or via the Portainer console on the `book-sync` container.) This goes away
once the dashboard can do the same thing from the browser.

## Folder scan (Phase 2)

Once a day (`FOLDER_SCAN_CRON`, default 3am), each user's download folder is
scanned for recognized ebook files (`.epub`, `.pdf`, `.mobi`, `.azw3`,
`.cbz`, `.cbr`) that aren't already tracked in the database:

- For `.epub` files, the real title/author is read out of the file's own
  metadata (it's a zip containing an OPF package document with Dublin Core
  fields) -- not guessed from the filename. Other formats fall back to
  parsing the app's own `Author - Title.ext` naming convention, or just the
  filename as the title if that pattern isn't there.
- If the extracted title/author fuzzy-matches one of that user's pending
  (or still-searching) books, that book is marked `downloaded` with
  `source=manual` instead of getting queued for an Anna's Archive search.
- If it doesn't match anything, it's recorded as a brand new book
  (`source=manual`) so it's visible in the database/dashboard instead of
  being invisible to the app.

To trigger a scan immediately instead of waiting for the schedule:

```bash
docker kill --signal=SIGUSR2 book-sync
# or, as a one-off from outside the running process:
docker exec -it book-sync node dist/cli/scan-folders.js
```

## Dashboard (Phase 4, not yet built)

Once running, the dashboard will be available at
`http://<nas-ip>:47291` (or whatever you set `DASHBOARD_PORT` to; no
authentication -- intended for LAN-only access) for managing users,
watching the queue, and triggering a manual sync. Health check in the
meantime: `http://<nas-ip>:47291/health`.

## Local development

```bash
npm install
cp .env.example .env
npm run db:generate   # after changing src/db/schema.ts
npm run dev            # tsx watch, runs src/index.ts directly
npm test                # unit tests (match/backoff/epub-metadata logic)
npm run user:add -- "Alice" "104614681" "/downloads/Alice" "alice@example.com"
npm run user:list
npm run folders:scan    # run a folder scan immediately
npm run books:requeue -- --all-downloaded   # recovery: reset downloaded books back to pending
```

## Data

- **Database:** SQLite, persisted via the `book-sync-data` Docker volume.
- **Downloads:** saved to each user's configured path under `/downloads`.

The database tracks book status (`pending`, `downloaded`, `not_found`),
attempt counts, retry timing, and how each book was discovered
(`goodreads` sync vs. `manual` folder addition).
