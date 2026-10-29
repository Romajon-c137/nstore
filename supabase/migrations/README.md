# Incremental backend patches

These files patch an existing Nstore database. This folder does **not** contain
a complete schema bootstrap or the migration history of production.

`20261023000100_checkout_validation_and_reservations.sql` requires the current
seven-argument `public.place_order` returning text, the tables/columns used by
the retail-default RPC, and the reservation functions/triggers from
`supabase_migration_fix_reservation_trigger.sql`.

Before application, reconcile a schema inventory with staging and confirm
function owners, RLS/grants and triggers. Do not apply every legacy root SQL
file alphabetically. This patch preserves the RPC signature and existing
function ACLs; it does not close direct INSERT policies on `crm_tasks`.

The patch combines repeated products, locks them in UUID order, rejects empty
or malformed carts and inactive/unpriced products, and checks delivery-point
ownership. It also releases OLD products when status and items change together.
The input is limited to 500 lines and quantities fitting the existing integer
contract. Nonpositive final prices are rejected.

Idempotency, direct-write RLS, B2B minimum/pack rules, payment transactions and
ERP stock ownership remain separate work. No production deployment is implied.
The existing stock decrement on `done` is retained pending ERP reconciliation.

Run `npm run test:checkout` for synthetic PostgreSQL tests. These do not replace
multiple-connection PostgreSQL, deployed RLS, ERP or provider integration tests.
