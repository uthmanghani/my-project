# AccounTrack Pro — backend test suite

Run everything:

```
npm install    # only needed once, for express-validator (validators.test.js)
npm test
```

Or directly: `node --test` (run from this directory — `be/`, the project root).

## What's covered, and why these specific things

Every test here exists because of a bug this app actually had, found during a
manual audit. The suite exists so the *next* bug like these gets caught by
`npm test` instead of by another full manual read-through:

- **`billController.test.js`** — the original "bill posts to the ledger but
  Products doesn't update" bug (stock must follow `productId` on a line, not
  the name of the account the user picked), cross-tenant access (IDOR), and
  that business-rule errors (e.g. "Bill already fully paid") reach the
  client verbatim while genuine internal errors don't leak their raw
  message.
- **`assetController.test.js`** — the depreciation double-posting bug
  (posting twice in the same month must charge the months once, not twice),
  incremental posting after a gap, the cap at the depreciable amount, and
  IDOR.
- **`purchaseOrderController.test.js`** — converting a PO to a bill via the
  real bill-posting logic, and that converting twice can't create two bills.
- **`recurringBillingController.test.js`** — that both invoice-type and
  bill-type schedules generate real, correctly-posted records; that a
  paused schedule can't run; and that every frequency (weekly/
  monthly/quarterly/yearly) advances `nextDate` correctly.
- **`validators.test.js`** — the express-validator chains that guard every
  financial write endpoint: rejects non-numeric amounts (the exact bug
  class the bill fix was about), negative quantities, malformed IDs, and
  unbalanced journal entries.

## How it works without a real database

`test/helpers/mockModels.js` provides small in-memory stand-ins for the
Mongoose models (no MongoDB connection, no network, runs in milliseconds).
It is **not** a schema/validation check — it exists to test controller
*logic*: the arithmetic, the state transitions, the access control. Nothing
here replaces testing against a real database before a release; treat this
as the fast first line of defense, not the only one.

If you add a new controller function that changes money, stock, or
who-can-access-what, the pattern to copy is: seed accounts/products with
`seedAccount`/`db.products.push(...)`, load the controller with
`loadController('controllers/x.js', db)`, call it with `mockReqRes(...)`,
and assert on both the response and the state left behind in `db`.
