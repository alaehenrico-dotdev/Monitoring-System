-- Saved product-order templates (the "Select Excel template" feature in Arrange
-- product order): the categories and products, in order, that a template lists.
-- Kept in the database - not read from the file each time - so a template is still
-- there after a reset or rebuild. The Data Reset leaves this table alone.

-- CreateTable
CREATE TABLE `order_templates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `rows` JSON NOT NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `order_templates_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The encoders' default order ("encoder product and category default order.xlsx",
-- first sheet: 56 products in 6 categories), so every install - new or existing -
-- starts with it.
INSERT INTO `order_templates` (`name`, `rows`, `updatedAt`)
VALUES ('Encoder default order', '[{"category":"PREMIUM (350 ML)","name":"SPECIAL"},{"category":"PREMIUM (350 ML)","name":"FISH SAUCE"},{"category":"PREMIUM (350 ML)","name":"CANE VINEGAR WHITE"},{"category":"PREMIUM (350 ML)","name":"CANE VINEGAR RED"},{"category":"PREMIUM (350 ML)","name":"TOYO MANSI"},{"category":"PREMIUM (350 ML)","name":"LIQUID SEASONING"},{"category":"PREMIUM (350 ML)","name":"PREMIUM BLACK FOR GUISADO"},{"category":"PREMIUM (350 ML)","name":"SUKANG MALIGALIG"},{"category":"CLASS A -(LITER)","name":"SWEET A"},{"category":"CLASS A -(LITER)","name":"SPECIAL A"},{"category":"CLASS A -(LITER)","name":"MORE SWEET A"},{"category":"CLASS A -(LITER)","name":"DARK SOYSAUCE A"},{"category":"CLASS A -(LITER)","name":"FISH SAUCE A"},{"category":"CLASS A -(LITER)","name":"CANE VINEGAR WHITE A"},{"category":"CLASS A -(LITER)","name":"OYSTER SAUCE A"},{"category":"CLASS A -(LITER)","name":"OYSTER SAUCE DARK A"},{"category":"CLASS A -(LITER)","name":"TOYO MANSI"},{"category":"CLASS A -(LITER)","name":"CATSUP A"},{"category":"CLASS A -(LITER)","name":"CATSUP FOR BURGER"},{"category":"CLASS A -(LITER)","name":"JAMPONG CHILI HOT SAUCE"},{"category":"CLASS A -(LITER)","name":"PALM OIL"},{"category":"PREMIUM (LITER)","name":"SPECIAL"},{"category":"PREMIUM (LITER)","name":"FISH SAUCE"},{"category":"PREMIUM (LITER)","name":"PATIS PURO"},{"category":"PREMIUM (LITER)","name":"CANE VINEGAR WHITE"},{"category":"PREMIUM (LITER)","name":"CANE VINEGAR RED"},{"category":"PREMIUM (LITER)","name":"LIQUID SEASONING"},{"category":"PREMIUM (LITER)","name":"PREMIUM BLACK FOR GUISADO"},{"category":"CLASS A (GALLON)","name":"SWEET A"},{"category":"CLASS A (GALLON)","name":"SWEET CHAMI"},{"category":"CLASS A (GALLON)","name":"SPECIAL A"},{"category":"CLASS A (GALLON)","name":"MORE SWEET A"},{"category":"CLASS A (GALLON)","name":"DARK SOYSAUCE A"},{"category":"CLASS A (GALLON)","name":"FISH SAUCE A"},{"category":"CLASS A (GALLON)","name":"CANE VINEGAR WHITE A"},{"category":"CLASS A (GALLON)","name":"CANE VINEGAR RED"},{"category":"CLASS A (GALLON)","name":"OYSTER SAUCE A"},{"category":"CLASS A (GALLON)","name":"OYSTER SAUCE DARK A"},{"category":"CLASS A (GALLON)","name":"TOYO MANSI"},{"category":"CLASS A (GALLON)","name":"CATSUP A"},{"category":"CLASS A (GALLON)","name":"CATSUP FOR BURGER"},{"category":"CLASS A (GALLON)","name":"JAMPONG CHILI HOT SAUCE"},{"category":"CLASS A (GALLON)","name":"PALM OIL"},{"category":"PREMIUM ( 3.785 LITERS P.E.T)","name":"SPECIAL"},{"category":"PREMIUM ( 3.785 LITERS P.E.T)","name":"FISH SAUCE"},{"category":"PREMIUM ( 3.785 LITERS P.E.T)","name":"CANE VINEGAR WHITE"},{"category":"PREMIUM ( 3.785 LITERS P.E.T)","name":"CANE VINEGAR RED"},{"category":"PREMIUM ( 3.785 LITERS P.E.T)","name":"LIQUID SEASONING"},{"category":"Other PRODUCTS","name":"SUKANG MALIGALIG 750ML"},{"category":"Other PRODUCTS","name":"CASSAVA"},{"category":"Other PRODUCTS","name":"RETAIL SALT"},{"category":"Other PRODUCTS","name":"DISTILLED CANE VINEGAR WHITE"},{"category":"Other PRODUCTS","name":"GROUND/BLACK PEPPER"},{"category":"Other PRODUCTS","name":"ONION POWDER"},{"category":"Other PRODUCTS","name":"CHILI POWDER"},{"category":"Other PRODUCTS","name":"NSC TOYOMANSI"}]', CURRENT_TIMESTAMP(3));
