// Synthetic PostgreSQL regression tests. No network, ERP, payment or customer data.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const patch = await read('supabase/migrations/20261023000100_checkout_validation_and_reservations.sql');
const uid = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const a = '33333333-3333-4333-8333-333333333333';
const b = '33333333-3333-4333-8333-333333333334';
const foreign = '44444444-4444-4444-8444-444444444444';
const own = '44444444-4444-4444-8444-444444444445';
const fixture = `
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE profiles(id uuid PRIMARY KEY, company_id uuid);
CREATE TABLE locations(id uuid PRIMARY KEY, company_id uuid, address text);
CREATE TABLE products(id uuid PRIMARY KEY, sku text, name text, stock integer,
  reserved_qty integer DEFAULT 0, is_active boolean DEFAULT true,
  price numeric, price_tp numeric, price_top numeric, section_name text);
CREATE TABLE contracts(user_id uuid, price_list text, discount_pct numeric);
CREATE TABLE discounts(user_id uuid, section_id text, discount numeric);
CREATE SEQUENCE order_numbers;
CREATE TABLE crm_tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text DEFAULT ('TEST-' || nextval('order_numbers')), task_type text,
  order_status text, client_id uuid, client_name text, client_phone text,
  location_id uuid REFERENCES locations(id), address text, items jsonb,
  total numeric, is_active boolean, title text);
INSERT INTO profiles VALUES ('${uid}','${uid}'),('${other}','${other}');
INSERT INTO locations VALUES ('${own}','${uid}','Synthetic own address'),
  ('${foreign}','${other}','Synthetic other address');
`;
let db;
const item = (id = a, qty = 1) => ({ id, qty, price: 1, unit: 'шт' });
const rows = async (sql, args) => (await db.query(sql, args)).rows;
const orders = () => rows('SELECT * FROM crm_tasks');
const stock = async (id = a) => (await rows('SELECT stock,reserved_qty FROM products WHERE id=$1',[id]))[0];
const place = (items, { clientId = uid, locationId = null } = {}) => rows(
  'SELECT public.place_order($1::jsonb,$2::uuid,$3::text,$4::text,$5::uuid,$6::text,$7::numeric) AS number',
  [items === null ? null : JSON.stringify(items),clientId,'Synthetic customer','synthetic',locationId,'Synthetic',1],
);
async function rejectsClean(items, code, args) {
  await assert.rejects(place(items,args), (err) => err.message.startsWith(code));
  assert.equal((await orders()).length,0);
  assert.deepEqual(await stock(), { stock: 10, reserved_qty: 0 });
}
before(async () => {
  db = new PGlite();
  await db.exec(fixture);
  await db.exec(await read('supabase_migration_place_order_retail_default.sql'));
  await db.exec(await read('supabase_migration_fix_reservation_trigger.sql'));
  await db.exec(patch);
});
beforeEach(async () => {
  await db.exec(`TRUNCATE crm_tasks,products,contracts,discounts;
    INSERT INTO products(id,sku,name,stock,price,price_tp,price_top,section_name) VALUES
      ('${a}','TEST-A','Synthetic A',10,1000,800,700,'Test section'),
      ('${b}','TEST-B','Synthetic B',10,2000,1600,1400,'Test section');
    SET request.jwt.claim.sub='${uid}';`);
});
after(async () => { await db?.close(); });

test('duplicate lines cannot reserve 12 from stock 10; transaction stays clean', async () => {
  await rejectsClean([item(a,6),item(a,6)],'INSUFFICIENT_STOCK:');
});
test('valid duplicates merge, retain first unit, and use server prices', async () => {
  const result = await place([{...item(a,2),unit:'first'}, {...item(a,3),unit:'second'}]);
  const [order] = await orders();
  assert.match(result[0].number,/^TEST-/);
  assert.equal(order.items.length,1);
  assert.equal(order.items[0].qty,5);
  assert.equal(order.items[0].unit,'first');
  assert.equal(Number(order.total),5000);
  assert.equal((await stock()).reserved_qty,5);
});
test('one insufficient product leaves every product unreserved', async () => {
  await rejectsClean([item(a,2),item(b,11)],'INSUFFICIENT_STOCK:');
  assert.equal((await stock(b)).reserved_qty,0);
});
for (const [name,payload,code] of [
  ['empty cart',[],'INVALID_ITEMS'],
  ['null cart',null,'INVALID_ITEMS'],
  ['object instead of array',{},'INVALID_ITEMS'],
  ['null line',[null],'INVALID_ITEM'],
  ['zero qty',[item(a,0)],'INVALID_ITEM'],
  ['negative qty',[item(a,-1)],'INVALID_ITEM'],
  ['fractional qty',[item(a,1.5)],'INVALID_ITEM'],
  ['invalid UUID',[item('not-a-uuid')],'INVALID_ITEM'],
  ['integer overflow',[item(a,2147483648)],'INVALID_ITEM'],
  ['sum overflow',[item(a,2147483647),item(a,1)],'INVALID_ITEM'],
  ['too many lines',Array.from({length:501},()=>item()),'INVALID_ITEMS'],
]) test(`rejects ${name}`, async () => { await rejectsClean(payload,code); });

test('anonymous caller and another client ID are rejected', async () => {
  await rejectsClean([item()],'CLIENT_MISMATCH',{clientId:other});
  await db.exec("SET request.jwt.claim.sub=''");
  await rejectsClean([item()],'AUTH_REQUIRED');
});
test('inactive and missing products are rejected', async () => {
  await db.exec('UPDATE products SET is_active=false');
  await rejectsClean([item()],'PRODUCT_INACTIVE:');
  await rejectsClean([item(foreign)],'PRODUCT_NOT_FOUND:');
});
test('foreign location is rejected; own company location is accepted', async () => {
  await rejectsClean([item()],'LOCATION_NOT_ALLOWED',{locationId:foreign});
  await place([item()],{locationId:own});
  assert.equal((await orders())[0].location_id,own);
});
for (const price of ['NULL','0','-1',"'NaN'::numeric","'Infinity'::numeric"]) {
  test(`invalid retail price ${price} cannot create a free/invalid order`, async () => {
    await db.exec(`UPDATE products SET price=${price}`);
    await rejectsClean([item()],'NO_PRICE:');
  });
}
test('contract TP price and discount precedence are retained', async () => {
  await db.exec(`INSERT INTO contracts VALUES ('${uid}','price_tp',10);
    INSERT INTO discounts VALUES ('${uid}','Test section',50)`);
  await place([item(a,2)]);
  assert.equal(Number((await orders())[0].total),1440);
});
test('section discount applies when contract discount is absent', async () => {
  await db.exec(`INSERT INTO discounts VALUES ('${uid}','Test section',15)`);
  await place([item()]);
  assert.equal(Number((await orders())[0].total),850);
});
test('top price bypasses other discounts as before', async () => {
  await db.exec(`INSERT INTO contracts VALUES ('${uid}','price_top',10);
    INSERT INTO discounts VALUES ('${uid}','Test section',50)`);
  await place([item()]);
  assert.equal(Number((await orders())[0].total),700);
});
test('missing wholesale price falls back to retail', async () => {
  await db.exec(`INSERT INTO contracts VALUES ('${uid}','price_tp',NULL);
    UPDATE products SET price_tp=NULL`);
  await place([item()]);
  assert.equal(Number((await orders())[0].total),1000);
});
test('rounding to a zero final price is rejected', async () => {
  await db.exec(`INSERT INTO contracts VALUES ('${uid}',NULL,100)`);
  await rejectsClean([item()],'NO_PRICE:');
});
for (const newItems of ["'[]'::jsonb",'NULL',`'[{"id":"${b}","qty":1}]'::jsonb`]) {
  test(`cancel and replace items with ${newItems} releases old products`, async () => {
    await place([item(a,6)]);
    await db.exec(`UPDATE crm_tasks SET order_status='cancelled',items=${newItems}`);
    assert.equal((await stock()).reserved_qty,0);
    assert.equal((await stock(b)).reserved_qty,0);
    assert.equal((await stock()).stock,10);
  });
}
test('editing an active order recalculates old and new products', async () => {
  await place([item(a,2)]);
  await db.query('UPDATE crm_tasks SET items=$1::jsonb',[JSON.stringify([item(b,3)])]);
  assert.equal((await stock()).reserved_qty,0);
  assert.equal((await stock(b)).reserved_qty,3);
});
test('completion retains existing stock decrement and releases reserve', async () => {
  await place([item(a,2)]);
  await db.exec("UPDATE crm_tasks SET order_status='done'");
  assert.deepEqual(await stock(),{stock:8,reserved_qty:0});
});
test('failed order insert rolls back reservations', async () => {
  await db.exec(`CREATE FUNCTION reject_test_order() RETURNS trigger LANGUAGE plpgsql AS
    $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_INSERT_FAILURE'; END $$;
    CREATE TRIGGER reject_test_order BEFORE INSERT ON crm_tasks FOR EACH ROW EXECUTE FUNCTION reject_test_order();`);
  try { await rejectsClean([item()],'SYNTHETIC_INSERT_FAILURE'); }
  finally { await db.exec('DROP TRIGGER reject_test_order ON crm_tasks; DROP FUNCTION reject_test_order()'); }
});
test('reapplying the patch preserves existing order and reserves', async () => {
  await place([item(a,2)]);
  await db.exec(patch);
  assert.equal((await orders()).length,1);
  assert.equal((await stock()).reserved_qty,2);
});
test('preflight rejects an incompatible schema before replacing functions', async () => {
  const isolated = new PGlite();
  try {
    await isolated.exec(`CREATE FUNCTION public.place_order(jsonb,uuid,text,text,uuid,text,numeric)
      RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;`);
    await assert.rejects(isolated.exec(patch),/CHECKOUT_SCHEMA_MISMATCH/);
    await isolated.exec('ROLLBACK');
    assert.equal((await isolated.query("SELECT pg_get_function_result('public.place_order(jsonb,uuid,text,text,uuid,text,numeric)'::regprocedure) AS type")).rows[0].type,'uuid');
  } finally { await isolated.close(); }
});
