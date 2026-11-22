# Monitoring visits

A monitoring visit record keeps what you saw on a visit to a funded
organisation, who was there and what happens next. It is a record for your
team. It does not change an application or a grant.

## Record a visit

You need "Record monitoring visits".

1. Open **Visits** and choose **Record a visit**.
2. Under **Organisation**, search by name and choose the organisation you
   visited. Choose from the results. You cannot type an id.
3. Under **Application**, optionally search by reference or name and choose the
   application the visit relates to.
4. Enter the **Date of visit**.
5. Under **How the visit took place**, choose In person, Video call or Phone
   call.
6. Under **Attendees**, search for each person and choose **Add an attendee**
   from the results. Attendees are people already on record. Add a person to the
   CRM first if they are not there. Choose **Remove** followed by a name to take
   one off.
7. Under **Findings**, write what you saw, up to 10,000 characters.
8. Choose **Add follow-up** for each action. Enter what needs doing, up to 300
   characters. Tick **Done** when it is finished.
9. Choose **Record visit**.

The page says "Visit recorded" and links to the visit.

The form is one column, and the **Visits** list reads in one column at any
width, so you can use both on a phone. You need a connection while you fill
them in. The offline field app is not part of this release.

## Change a visit

1. Open **Visits** and choose the visit.
2. Change the date, type, attendees, findings or follow-ups.
3. Choose **Save changes**.

A visit stays with its organisation and application. To correct either, record
a new visit. Changes are saved under your name.

The **Visits** list shows each visit with its date and type, and how many
follow-ups are still open.

## Evidence files

A visit can hold evidence: files such as a photo or a signed note, each with
a short caption.

- A file is scanned before anyone can open it.
- Only a file that has passed its scan, and is not used anywhere else, can be
  linked to a visit. A file that is still being scanned, or has failed its
  scan, cannot be linked. The software says "A file can't be added" and asks you
  to upload it again.
- Each time someone downloads a file, an audit event records it.

The console cannot add evidence yet. There is no **Add evidence** button, and
an open visit shows how many files are linked and says adding more is not
available yet. A visit can hold up to 20 files.

## Photos, safeguarding and sensitive details

Visit records often name people, and photos show them. Take care.

- Get consent before you take a photo of anyone.
- Take safeguarding care. Follow your own safeguarding policy, especially for
  children and people at risk.
- Keep health and other sensitive personal details out of findings, captions
  and file names. Write what the check needs and no more.

Findings, follow-ups, captions and the list of attendees are personal data.
Because they can name people, they can be part of a person's subject access
request.

## How long visits are kept

A visit stays with its organisation and application, and is kept for as long as
they are. The software does not set a shorter period for visits. It does not
yet delete data when its time passes. See
[Retention and subject access](../../../docs/admin/retention-and-subject-access.md).

## Where it is recorded

Recording and changing a visit write audit events. They hold ids and the
fields changed, never a finding, caption or name. See the
[audit log guide](../../../docs/admin/audit-log.md).
