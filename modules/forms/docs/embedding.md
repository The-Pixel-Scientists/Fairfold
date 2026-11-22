# Embed a form

**Embedding is not available yet.** You cannot put a form on your own website
in a frame today. This page says what exists and what is coming.

## What exists

A form that anyone can answer has its own page on your portal address:
`/<your-slug>/forms/<form id>`. Link to it from your website. The page shows
your funder name above the form, so people know whose form it is.

The portal also contains an embed page, which is the same form without
navigation, for a separate embed address. Nothing serves that address yet.

## What is not built yet

- A **Copy embed code** button in the console.
- A list where a funder names the websites allowed to frame its forms.
- The separate embed address and the headers that let only those websites
  frame it.
- Custom domains. They are not part of the first version.

## What will stay true

- Only forms that anyone can answer can be embedded.
- The console and the portal are not offered for embedding. Only the embed
  page will be. Today the API refuses to be framed, and the web server
  configuration in this release sets no framing rule for the console or
  portal pages, so the operator's proxy must set one.
- The embedded page sets no cookie and shows no sign-in.

When embedding lands, this page will say how to copy the code, how to list your
websites, and how a self-hoster sets up the embed address.
