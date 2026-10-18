# Format 2 migration (one-off)

Converts ThunderNotes development data from file format 1 to format 2 (D25). The add-on itself
reads only format 2. Needs Node and core built: `npm run build -w @thundernotes/core`.

- **Carriers on an IMAP server:** `python3 -I migrate.py --host … --user …` is a read-only dry run
  that converts and checks every carrier. Add `--apply` to write: the originals are saved to a
  backup folder, the converted carriers uploaded, then the originals deleted. The password comes
  from `THUNDERNOTES_IMAP_PASSWORD` or is asked for. Run it per account, then update the add-on
  on every device.
- **An export zip:** `node convert.ts export old.zip new.zip`.

`legacy/` is a frozen copy of the format-1 reader (core at 4116f81), used only here.
