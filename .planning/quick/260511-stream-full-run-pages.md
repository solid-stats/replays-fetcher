# Stream full-run pages

## Goal

Allow a controlled full-run to upload raw replay files to S3 and stage each page
before discovering the next page, so `server-2` and parser workers can process
in parallel with continued fetching.

## Change

- Add `REPLAY_SOURCE_MAX_PAGES`.
- Change `run-once` to discover one page, store raw files, stage records, then
  continue to the next page.
- Treat an empty `REPLAY_SOURCE_TRANSPORT` as the default direct transport.
