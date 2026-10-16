-- Product names are stored in UPPERCASE (see utils/productName.ts), the way the
-- encoders' own sheets write them. Only the name changes: ids, SKUs, categories
-- and every entry that points at a product are untouched. Matching on names is
-- case-insensitive everywhere, so nothing that already matched stops matching.
UPDATE `products` SET `name` = UPPER(TRIM(`name`));
