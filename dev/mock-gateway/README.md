# Mock gateway (UI work only)

A stand-in for the `hid-system` gateway so the portal's dashboards open signed
in with sample data, with no backend. It is dev tooling: no real auth, no
storage, never deployed, and it changes no app code.

## Run

Two terminals from the repo root:

```bash
npm run dev:mock                              # mock gateway on http://localhost:3000
npm run dev --workspace @hid/patient-web      # portal on http://localhost:3200
```

Open:

| Dashboard | URL |
| --- | --- |
| Patient | http://localhost:3200/ |
| Provider (blue EHR, Demo Hospital) | http://localhost:3200/provider |
| Platform admin | http://localhost:3200/admin |

Use `localhost`, not `127.0.0.1`. The workspace is chosen by the page asking,
so all three work side by side.

Options (environment variables):

- `MOCK_FACILITY=classic` shows the classic provider workspace instead of the blue EHR.
- `MOCK_PORT=3001` runs on another port (set `HID_LOCAL_GATEWAY_ORIGIN` in `apps/patient-web/.env.local` to match).

On Windows PowerShell: `$env:MOCK_FACILITY="classic"; npm run dev:mock`.

## Logging backend needs

Any request the mock has no answer for gets a 404, which most optional cards
treat as "hidden". Each one is also written to `backend-needs.log` in this
folder (git-ignored) and printed in yellow. If a UI change needs data the
backend doesn't serve, that log is the record to hand to the backend team.
Don't add the endpoint to the mock as if it exists.

## Sample data

All of it lives in `server.mjs`. Edit it there to test empty states, long
names, many rows and so on.
