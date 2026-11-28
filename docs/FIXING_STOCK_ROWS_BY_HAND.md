# Fixing stock figures by hand in the database

For the rare day when a product's Opening / Stock / Remaining figures are wrong and the app cannot
put them right by itself (a bad merge, a bad import, a bug that wrote the wrong figure). It was written
after correcting Palm Oil Gallon and Liter on a live system, so every warning below is something that
actually went wrong or nearly did.

**Prefer the app when it can do the job.** Fixing a row by hand skips the Change Log, the day locks
and every safety check. Use it only when the app's own routes below cannot reach the figure.

| Situation | Use this first |
|---|---|
| The opening of a day should follow a physical count | Audit page: count it, publish with "use as next day's opening" ticked. Later saved days are re-derived and your entries are kept. |
| A published audit was wrong | Audit History > Revert (give a reason), correct the counts, publish again. |
| One opening is wrong because the day before changed | Save a real change on the earlier day; later openings are re-derived. A save with no change does nothing. |
| A finished day cannot follow a change | Admin Queue > stale opening request > approve. |
| None of the above reaches it | This guide. |

---

## 1. Before you touch anything

1. **Take a backup.** Settings > Backup > Download, or `npm run backup` from the repo root. Keep the
   file until you have checked the result.
2. **Pause entry** for the product (and ideally the sheet) while you work. A save made in the app while
   your change is open can collide with it.
3. **Write down what you are about to change**: product, channel, date, old figure, new figure and why.
   Direct edits are not recorded in the Change Log.
4. **Know which database you are in.** The connection name and host are shown at the top of the tool.
   If it says production, every statement is live.

## 2. How the figures work (you need this to get the numbers right)

Two tables hold the daily rows, one row per product, date and shift (`MORNING` or `NIGHT`):

| Table | Stock subtotal | Remaining |
|---|---|---|
| `daily_online_stock` | `onlineStock = openingStock + stockInOffToOl - stockOutOlToOff` | `remainingStock = onlineStock + productionIn - fulfillmentOut + rts` |
| `daily_offline_stock` | `offlineStock = openingStock + stockInOlToOff - stockOutOffToOl` | `remainingStock = offlineStock + productionIn - deliveryOut - upsellOut + backloads` |

- `openingStock`, the subtotal and `remainingStock` are **stored values**. Changing only `openingStock`
  leaves the other two wrong, so change all three together, built from the **same** opening number.
- The entries (production, fulfillment, delivery and so on) are never touched by a fix like this.
- **Carry-forward:** a day's first period opens at the previous period's `remainingStock`; the Night row
  opens at the same day's Morning row. A published audit count that was applied to the next day's
  opening replaces the carried figure (`manual_counts`, `appliedToOpening = 1`).
- **The `⚠` marker** on an Opening cell (an expected figure struck through next to the real one) means
  "the stored opening is not what the previous period carries forward". The struck-through number is the
  app's own carry-forward. It is a warning only and blocks nothing. It clears when the opening matches, or
  when an applied audit count backs the figure you chose.
- Products are found by `products.sku`, not by id. Ids differ between databases, so look them up.

## 3. Find the rows

Read-only. Replace the SKUs and the date.

```sql
-- Which products?
SELECT id, sku, name, category FROM products WHERE sku IN ('AFP069','AFP070');

-- The rows to fix: Online, then Offline
SELECT r.id, p.sku, p.name, r.shift, r.openingStock, r.remainingStock, r.updatedAt
FROM daily_online_stock r JOIN products p ON p.id = r.productId
WHERE p.sku IN ('AFP069','AFP070') AND r.entryDate = '2026-11-26' ORDER BY p.sku, r.shift;

SELECT r.id, p.sku, p.name, r.shift, r.openingStock, r.remainingStock, r.updatedAt
FROM daily_offline_stock r JOIN products p ON p.id = r.productId
WHERE p.sku IN ('AFP069','AFP070') AND r.entryDate = '2026-11-26' ORDER BY p.sku, r.shift;

-- The day before (what each row should carry forward) and any audit counts
-- (use the same two SELECTs with the previous date, and:)
SELECT c.id, c.entryDate, c.shift, c.location, c.manualCount, c.appliedToOpening, c.publishedAt
FROM manual_counts c JOIN products p ON p.id = c.productId
WHERE p.sku IN ('AFP069','AFP070') AND c.entryDate BETWEEN '2026-11-24' AND '2026-11-27'
ORDER BY c.entryDate, c.location;
```

Write the target opening for every row down **before** you run anything, from the carry-forward, the
audit counts or the owner's decision. Online and Offline are different tables with different ids.

## 4. Change a row

Rules that matter:

- **One statement at a time.** Click inside the statement and press `Ctrl+Enter`. Never run-all.
- **Always key on the row `id`** (the tool's Safe Updates mode refuses updates that are not) and add the
  date as a guard: if the id is wrong, 0 rows change instead of the wrong row.
- **Use the same opening number three times.** A statement like `openingStock = 241` with
  `remainingStock = 202 + ...` corrupts the row.
- Run inside a transaction, so you can undo.

```sql
START TRANSACTION;
```

Online row:

```sql
UPDATE daily_online_stock
SET openingStock   = <NEW>,
    onlineStock    = <NEW> + stockInOffToOl - stockOutOlToOff,
    remainingStock = <NEW> + stockInOffToOl - stockOutOlToOff + productionIn - fulfillmentOut + rts
WHERE id = <ID> AND entryDate = '<YYYY-MM-DD>';
```

Offline row:

```sql
UPDATE daily_offline_stock
SET openingStock   = <NEW>,
    offlineStock   = <NEW> + stockInOlToOff - stockOutOffToOl,
    remainingStock = <NEW> + stockInOlToOff - stockOutOffToOl + productionIn - deliveryOut - upsellOut + backloads
WHERE id = <ID> AND entryDate = '<YYYY-MM-DD>';
```

Replace `<ID>`, `<NEW>` and the date with real values, or the statement errors. After each update the
output must say **1 row affected**. Anything else: stop, and run `ROLLBACK;` if unsure.

Check, then finish:

```sql
SELECT id, openingStock, remainingStock FROM daily_online_stock  WHERE id IN (<ids>);
SELECT id, openingStock, remainingStock FROM daily_offline_stock WHERE id IN (<ids>);
```

```sql
COMMIT;      -- or ROLLBACK; to undo everything since START TRANSACTION
```

**Nothing is visible to the app until you run `COMMIT;`.** A green `TX OPEN` badge in the tool means a
transaction is still open and uncommitted. If the app still shows the old figure, this is why.

## 5. After you commit

1. **Refresh the app** and look at the cells you changed.
2. **Later days.** Every later row's opening must equal the previous period's new `remainingStock`.
   Check them and fix in date order:

```sql
SELECT 'ONLINE' AS loc, r.id, p.sku, r.entryDate, r.shift, r.openingStock, r.remainingStock
FROM daily_online_stock r JOIN products p ON p.id = r.productId
WHERE p.sku IN ('AFP069','AFP070') AND r.entryDate > '2026-11-26'
UNION ALL
SELECT 'OFFLINE', r.id, p.sku, r.entryDate, r.shift, r.openingStock, r.remainingStock
FROM daily_offline_stock r JOIN products p ON p.id = r.productId
WHERE p.sku IN ('AFP069','AFP070') AND r.entryDate > '2026-11-26'
ORDER BY entryDate, loc, sku;
```

3. The `⚠` may stay if you set an opening that differs from the carry-forward on purpose. It is a
   warning only. To clear it properly, back the figure with an applied audit count.
4. Note what you changed (the sheet from step 1.3), and keep the backup until you are sure.

## 6. When something goes wrong

| Message / symptom | Meaning | What to do |
|---|---|---|
| `1175` (Safe Updates) | The update is not keyed on the primary key | Use `WHERE id = <ID>` with no join. |
| Result grid is not editable | Results of a join or union are read-only | Use the `UPDATE` statements, not the grid. |
| `1227` needs the PROCESS privilege | The account may not list other sessions' transactions | Use `SHOW FULL PROCESSLIST;` instead (see below). |
| `1142` UPDATE command denied | The account has no update rights | Use an account that does. |
| `1205` Lock wait timeout exceeded | Another connection holds that row | See below. Nothing was changed. |
| The app still shows the old figure | Your change is not committed | Run `COMMIT;`. |
| Row says `0 rows affected` | The id or the date did not match | Re-read the id from the find query. |

### Lock wait timeout (1205)

Another connection has an open, uncommitted transaction touching that row. Usually it is a leftover
from your own earlier attempt: closing a tab does not always end its connection.

1. In your tab run `ROLLBACK;`.
2. Run `SHOW FULL PROCESSLIST;`. If the tool connects as the app's own user you will see the app's
   connections too.
   - The app's own connections have `Host` = `localhost` with **no port**, a small `Time`, and there
     are about ten of them. **Never kill these.**
   - Your tool's connections have a port in `Host` (`localhost:54418`) and show `db` as `NULL` or the
     database name. Old ones with `Command = Sleep`, a large `Time` and an empty `Info` are leftovers.
   - Never kill the row showing `SHOW FULL PROCESSLIST` (that is you) or any running `Query`.
3. Kill only the old idle ones that belong to your tool, the ones with the database name first:
   `KILL <Id>;`. This rolls back whatever they had not committed, which is the abandoned attempt.
4. Retry from the transaction step. If it still times out, kill the next old idle connection, and look
   at the rows below the visible part of the list. If everything left is the app's, stop entry and
   ask whoever deploys the app to restart the service, which drops its connections.

## 7. Habits that avoid the problems this guide came from

- Keep one SQL tab for the whole job. Do not leave `START TRANSACTION;` open and walk away.
- Never paste a statement that still contains `<ID>` or a number you are unsure of.
- Check the sku, channel and date on every row before you change it. In the original incident one
  update hit the wrong product's row because the ids of two products sat next to each other.
- Do every row you meant to change, then check them all together, then commit once.
- If you are not sure, `ROLLBACK;` costs nothing.
