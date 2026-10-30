# ADR 0047: File uploads

- **Status:** accepted
- **Date:** 2026-10-05
- **Deciders:** Aaron Gardner

## Context

On 5 October 2026 file uploads moved into MVP1, due at the end of October.
Applicants attach documents to questions on an application form (accounts,
governing documents, quotes, photos), and staff download them.

[ADR 0005](0005-dev-topology.md) set the outline in its "Files" section:
uploads land in a quarantine prefix, ClamAV scans them, one S3 key pair per
purpose, an S3 POST policy for the browser's upload, a POST-only storage
route through a reverse proxy, and downloads proxied by the API. It said a
fuller files ADR comes before applicants can upload. That ADR, 0030, was
planned for 4 November with scanning in a worker
([ADR 0009](0009-background-jobs.md)).

MVP1 has neither piece that plan needs. There is no worker
([ADR 0020](0020-release-emails-without-a-worker.md)), and no reverse proxy:
the demo runs on `pnpm stack`, and the proxy was left to the files ADR
([ADR 0022](0022-serving-the-web-apps.md)).

Constraints:

- [Architecture rules](../ARCHITECTURE.md) 1 to 6 and 9: S3-compatible
  storage only, tenant isolation by row-level security, real constraints,
  audit, classification, and the server checks everything.
- URLs carry ids only, and request logs hold no personal data
  ([ADR 0004](0004-api-contract.md)). A file name often names a person.
- The Content Security Policy in [ADR 0006](0006-design-system.md).
- Dependencies are frozen for October except by Aaron's decision.
- Aaron reads security-critical code line by line, at about 550 lines a day.

## Options considered

Where the scan runs:

1. **Browser to storage under a POST policy, scanned by a worker.** ADR 0005's
   plan. The API never holds the bytes and files can be large. It needs
   pg-boss, a worker container, a quarantine and promotion step, a reverse
   proxy route to storage (the riskiest edge in a self-hosted install), and
   a pending state that the browser polls. Too much to build and review by
   30 October.
2. **Through the API, scanned with clamd's `INSTREAM` command during the
   request, and stored only if clean.** Nothing unscanned is ever stored. No
   worker, quarantine, POST policy or storage route, and the applicant hears
   the verdict at once. The API holds the file in memory and a database
   connection open during the scan, a few seconds, so it needs a size limit
   and a limit on scans at once. If the scanner is down, uploads stop.
3. **Store first, scan after the request commits**, as ADR 0020 sends emails.
   Unscanned files sit in storage, with more states and nothing gained
   without a worker.

Where files are stored:

4. **S3-compatible storage**, SeaweedFS in development and the stack, as
   ADR 0005 chose. The same path the managed service's Cloud Storage and any
   operator's storage use. It needs an S3 request signer.
5. **PostgreSQL `bytea`.** No dependency, and row-level security covers the
   content. It contradicts ADR 0005, makes the database and its backups grow
   with every file, and needs a data migration later.

How the bytes travel:

6. **Base64 inside JSON**, as the logo does. Reuses the JSON contracts, but
   sends a third more data and holds two copies in memory.
7. **The raw bytes as the request body, with the file name in a header.** No
   inflation, progress events in the browser, and ids-only URLs. The route
   contracts need a raw request body kind.
8. **`multipart/form-data`.** Needs a parser dependency during the freeze.

The signer, for option 4:

9. **`@smithy/signature-v4`**, the signer AWS maintains for its own SDK, with
   Node.js's built-in `fetch`. Four small packages.
10. **`@aws-sdk/client-s3`.** The full client, with a large tree and a
    credential chain we would not use.
11. **`aws4fetch` or `aws4`.** Small, but no release since August 2024.
12. **Our own SigV4 signing.** No dependency, about 100 more lines to read. A
    wrong signature is refused by storage, so mistakes fail closed.

## Decision

Options 2, 4, 7 and 9.

### Uploading

- A module owns its upload routes, because it decides who may attach what to
  which record. Grants has one per file question:
  `POST /portal/applications/{applicationId}/fields/{fieldId}/files`.
- The body is the file's bytes, sent as `application/octet-stream`. The file
  name travels percent-encoded in a `File-Name` request header. It never
  appears in a URL, a log line, a metric or an audit event.
- The session and permission are checked before the body is read, so an
  unauthorised request never makes the API hold a file.
- The server then checks, in this order:
  1. the record is the caller's and can still change (for grants, the
     applicant's own draft in an open round);
  2. the question exists in the pinned form version, is a file question and
     is shown for the current answers;
  3. the file count and size limits;
  4. the name;
  5. the file's type, from its first bytes and structure, never from its
     name or declared type;
  6. the name ends with one of that type's extensions, in any case
     (`fileNameMatchesType()`), or the file is refused as `wrong_extension`.
- It then inserts an `app.file` row in state `pending`, streams the bytes to
  clamd, and records the verdict:
  - **Clean:** the API computes the SHA-256, writes the object, marks the
    row `clean` with its hash and storage key, and links it to the record.
  - **Infected or error:** the row takes that state, nothing is stored, and
    the applicant is told the file was not uploaded and why, in plain words.
- All of this is one request and one transaction. A row never stays
  `pending` once the request ends.
- If the commit fails after the object was written, the object has no row
  and is never served. The retention sweep removes such objects when it
  lands.

### Scanning

- Only clamd's `stream: OK` is clean. A signature match is `infected`.
  Everything else is `error`: exceeded limits, encrypted content, the stream
  size limit, an unexpected reply, a refused connection and a timeout.
- clamd keeps ADR 0005's settings (`AlertExceedsMax`, `AlertEncrypted`,
  `StreamMaxLength` at or above the upload limit), with `MaxScanTime` at
  20 seconds. The API gives up at 25 seconds.
- clamd also runs with `AlertOLE2Macros yes`, and `ScanOLE2` and
  `ScanArchive` stay on. ClamAV opens Office's ZIP parts and nested
  documents and flags a VBA project whatever its part is called. A macro
  alert is a match, so the file is `infected`. This, not the type check's
  look at entry names, is what refuses VBA macros.
- At most 4 scans run at once in each API process, fewer than its database
  connections. Another upload gets 503 with `Retry-After`.
- The server's request timeout allows a 10 MB upload at about 1 Mbit/s
  (120 seconds). The header timeout stays short.

### Limits and types

- At most 10 MB (10 MiB, 10,485,760 bytes) per file. No tenant or form can
  raise it. A file question may set a lower limit, and from 1 to 10 files
  (1 by default).
- At most 100 MB (100 MiB) of attachments per application.
- File names are 1 to 200 characters once trimmed, with no control, format,
  line or paragraph separator characters and no path separators. A name
  that breaks a rule is refused, never changed.
- Allowed types, each checked by its structure:

  | Type | Check |
  | --- | --- |
  | PDF | Starts with `%PDF-` |
  | Word (`.docx`) | A ZIP whose central directory has `[Content_Types].xml` and `word/document.xml` |
  | Excel (`.xlsx`) | A ZIP whose central directory has `[Content_Types].xml` and `xl/workbook.xml` |
  | OpenDocument text and spreadsheet | A ZIP whose first entry is an uncompressed `mimetype` holding exactly the type |
  | JPEG | Starts with `FF D8 FF` |
  | PNG | Starts with the 8-byte PNG signature |

- A file's name must end with one of its type's extensions (`.pdf`,
  `.docx`, `.xlsx`, `.odt`, `.ods`, `.jpg` or `.jpeg`, `.png`), in any case,
  or it is refused. The check reads only a file's first bytes or entry
  names, so a file named `Budget.hta` or `Budget.bat` whose bytes start
  `%PDF-` could otherwise be stored as a PDF and run as a program when
  opened, and a `.docm` name could turn macros back on. The stored name is
  the download name, so a download always carries the checked type's
  extension.
- The type check refuses a document with an entry named as macros usually
  are: ending `vbaProject.bin`, or under `xl/macrosheets/`, `Basic/` or
  `Scripts/`. That is a fast first pass only, because Office finds a VBA
  project through a relationship and the part can have any name; clamd's
  macro alert (above) is the check. ZIP64 and split archives are refused.
  The check reads entry names only and never decompresses anything.
- A file whose bytes match none of the types is refused with the list of
  types the question accepts. No SVG, HTML, archives or programs.

### Storage and keys

- One bucket per deployment. Objects live only at
  `clean/<tenant id>/<file id>`. The server makes every key, and no key holds
  any part of a file name.
- The API holds two of ADR 0005's key pairs: the scanner's (write `clean/`)
  and the downloads' (read `clean/`). The uploads key and the quarantine
  prefix are not used.
- Storage calls go to the configured endpoint only, path-style, signed with
  `@smithy/signature-v4`. Only `apps/api/src/platform/files/` imports the
  signer or reads the keys.

### Records

- One platform table, `app.file`, holds every file: tenant, id, name, type,
  size, SHA-256, storage key, scan state, scan time, creating membership and
  creation time.
- Scan states run one way: `pending` to `clean`, `infected` or `error`. A
  final state never changes. The database sets the creation and scan times,
  and the storage key and hash exist exactly when the file is clean.
- In MVP1 `app_api` inserts the row and records the verdict once. When a
  worker scans instead, those column rights move to `app_worker`.
- A module links files through its own join table, with composite foreign
  keys to its record and to `app.file`, never a polymorphic owner column
  ([ADR 0016](0016-modular-suite-and-shared-warehouse.md)). Grants has
  `grants.application_file`: one row per file, naming the application and
  the form field. Only clean files can be linked, and only while the
  application is a draft.
- The join table is the answer. An application's `answers` never hold file
  ids; the server adds each file question's linked ids before it validates,
  projects or submits answers ([architecture rule 7](../ARCHITECTURE.md)).

### Downloads

- Only through the API, after the permission, scope and projection checks,
  streamed from storage. No presigned URLs in MVP1.
- Headers:
  - `Content-Type`: the type the check found;
  - `Content-Disposition: attachment`, with the stored name, which ends
    with the type's extension, encoded as RFC 6266 `filename*`;
  - `X-Content-Type-Options: nosniff`;
  - `Cache-Control: no-store`;
  - `Content-Security-Policy: default-src 'none'; sandbox`;
  - `Cross-Origin-Resource-Policy: same-origin`.
- Who may download:
  - The applicant: the files on their own applications.
  - Staff: under `grants.applications.read`, for submitted applications and
    questions whose audience includes staff.
  - Reviewers: none in MVP1. Every MVP1 reviewer has the blind projection,
    and a blind reviewer never receives a file answer, because a document
    can name the applicant whatever its file is called.
- A file the caller may not see, another tenant's file and a missing file
  all get the same 404.

### Audit

- `platform.file.uploaded` for a clean file, and `platform.file.refused` for
  `infected` or `error`, each with the file as its entity. Values are ids,
  type, size and verdict; never the name.
- Staff downloads are sensitive reads: `platform.file.downloaded`.
- An applicant reading their own files, and removing a file from their own
  draft, are not audited, as with a draft's answers.

### Classification and retention

- File names and file content are personal. The content is classified on
  the row that points to it, and one retention rule covers both. Every other
  column is internal.
- Linked files follow their record's retention rule. Refused rows follow the
  12-month audit floor.
- Removing an attachment deletes the link only. The row and object wait for
  the retention sweep, which is recorded debt before any real data, with
  erasure under [ADR 0027](0027-erasure-across-modules-and-audit.md).

### Left to ADR 0030

ADR 0030 (planned for 4 November) narrows to:

- the reverse proxy: TLS, compression, request logs, rate limits and the
  client address;
- per-user and per-address limits on uploads;
- rescans after signature updates;
- retention and erasure of file content;
- whether larger files go straight to storage with a worker scan.

The recommendation is to keep scanning in the request for files up to 10 MB.

## Consequences

- This amends ADR 0005's "Files" section. Files reach storage only after a
  clean verdict, so the quarantine prefix, the uploads key and the storage
  route are unused. Downloads stay proxied by the API.
- ADR 0006's policy needs no storage origin: `connect-src` stays `'self'`.
- [ADR 0004](0004-api-contract.md) gains a raw request body kind, for console
  and portal `POST` routes only, and raw responses on console and portal
  `GET` routes, each limited to the file types above.
- `pnpm stack` and CI run SeaweedFS and ClamAV. ClamAV needs more than 1 GB
  of memory and about a minute to start.
- While the scanner is down nobody can upload, and nothing unscanned is
  stored.
- A file whose name ends with another extension is refused, even when its
  content is fine (a PNG saved as `.jpg`, say). The applicant renames it.
- OpenDocument Basic and scripts are refused by entry name only: ClamAV's
  macro alert covers VBA, not them.
- A refused file never rejects an application. The applicant can attach
  another, and only a person decides the application
  ([architecture rule 9](../ARCHITECTURE.md)).
- A large upload holds a database connection for the length of its scan.
  The limit on scans at once keeps uploads from taking the pool.
- About 1,000 lines of security-critical review across contracts, schema,
  API and stack.
- Until ADR 0030 lands: no rate limits on uploads, no reverse proxy, and
  removed files stay in storage. That is acceptable on synthetic data, and
  each must be fixed before staging takes anyone real.

## Dependency check

| Package | Version | Licence | Released | Notes |
| --- | --- | --- | --- | --- |
| @smithy/signature-v4 | 5.7.4 | Apache-2.0 | 2026-09-25 | AWS's signer for its SDK; depends on @smithy/core 3.36.0 and @smithy/types 4.19.0 (Apache-2.0) and tslib 2.8.1 (0BSD); no install scripts; no advisories in GitHub's database on 5 October 2026 |
| @aws-sdk/client-s3 (not chosen) | 3.1146.0 | Apache-2.0 | 2026-10-02 | Active; large tree, including a credential chain |
| aws4fetch (not chosen) | 1.0.20 | MIT | 2024-08-28 | No release since |
| aws4 (not chosen) | 1.13.2 | MIT | 2024-08-28 | No release since |
| minio (not chosen) | 8.0.7 | Apache-2.0 | 2026-02-27 | 13 dependencies, including two XML parsers |
| ClamAV, SeaweedFS | As ADR 0005 | | | Separate containers, already pinned |

The clamd client, type checks and storage calls are our own code on Node.js
built-ins. Versions are pinned under the 7-day rule in
[ADR 0001](0001-monorepo-toolchain.md) when they are installed, and the
install records provenance.
