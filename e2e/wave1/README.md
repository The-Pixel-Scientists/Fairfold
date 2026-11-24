# Wave 1 journeys

One spec for each wave 1 tool (`crm`, `assure`, `forms`, `privacy`, `insight`), one for module-off and
tenant isolation, and one for the unsubscribe link and contact preferences. They call the live API as the
people of the `wave1` seed and open the console and portal screens where the screens have names to select by.
Everything is synthetic.

```
pnpm stack down --volumes && pnpm stack && pnpm stack seed wave1
TPS_E2E_WAVE1=1 pnpm test:stack -- wave1
```

Without `TPS_E2E_WAVE1=1` the specs skip themselves, because the demo journey needs a stack seeded with
`base`. A run changes the stack (a merge happens once), so use a fresh stack for each run.

Tests that wait for something the stack does not have yet skip with the reason in the report:

- crm import routes, and the merge routes without `TPS_CRM_PREVIEW_SECRET` in the stack settings;
- assure matches, because no sanctions list is loaded (the seed cannot write one);
- the anonymous form routes, which need the forms hash key and the `forms.public_form` and
  `forms.submit_public_response` functions;
- the rights request export routes;
- a signed unsubscribe token, which needs a marketing email and `TPS_UNSUBSCRIBE_SECRET`.

Each one runs as soon as its piece exists; nothing is stubbed.
