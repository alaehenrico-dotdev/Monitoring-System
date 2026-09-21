import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Section 4.1 - Product and Category Master List, taken directly from the
// business's actual monthly Online/Offline Stocks Monitoring reports
// (Section 8.1, e.g. "Online Monitoring - Sept 10, 2026 online/offline"),
// not the earlier placeholder guess - every name/category/order here
// matches what's on those sheets exactly, so the CSV re-import (see
// CsvTools.tsx) has real products to match against instead of a
// documentation-plan approximation. Two things on the source sheets were
// reconciled rather than copied literally: "TAKOYAKI SAUCE LITER" is listed
// twice in a row in the online report (a duplicate line, not a second
// product), and "Cassava" appears only in the online report's New Products
// section, not the offline one - kept once here since it's still one
// product shared by both grids, just with no offline activity that month.
//
// `sku` (the "updated skus.pdf" business gave the app its first real SKU
// codes - AFP001-AFP070) is matched onto each product by exact name+category
// against this same list, so an already-seeded product just gets its sku
// backfilled in place (see seedProducts below) rather than creating a
// duplicate row. Every code from that PDF maps to a product below except
// NSC's own "Toyomansi" - that row has no corresponding sized entry on the
// new sheet at all (every other "Toyomansi" already has one: 350ML, Liter,
// Gallon, Container), so it's left without a sku rather than guessed at.
const PRODUCT_CATEGORIES: { category: string; unit: string; products: { name: string; sku?: string }[] }[] = [
  {
    category: "Premium (350ML)",
    unit: "350 mL bottle",
    products: [
      { name: "Special", sku: "AFP001" },
      { name: "Fish Sauce", sku: "AFP002" },
      { name: "Cane Vinegar White", sku: "AFP003" },
      { name: "Cane Vinegar Red", sku: "AFP004" },
      { name: "Toyo Mansi", sku: "AFP005" },
      { name: "Liquid Seasoning", sku: "AFP044" },
      { name: "Premium Black for Guisado", sku: "AFP006" },
      { name: "Sukang Maligalig 350ML", sku: "AFP050" },
    ],
  },
  {
    category: "Class A (Liter)",
    unit: "Liter",
    products: [
      { name: "Sweet A", sku: "AFP007" },
      { name: "Special A", sku: "AFP008" },
      { name: "More Sweet A", sku: "AFP009" },
      { name: "Dark Soysauce A", sku: "AFP010" },
      { name: "Fish Sauce A", sku: "AFP011" },
      { name: "Cane Vinegar White A", sku: "AFP012" },
      { name: "Oyster Sauce A", sku: "AFP013" },
      { name: "Oyster Sauce Dark A", sku: "AFP014" },
      { name: "Toyo Mansi", sku: "AFP015" },
      { name: "Catsup A", sku: "AFP016" },
      { name: "Catsup for Burger", sku: "AFP017" },
      { name: "Jampong Hot Chili Sauce", sku: "AFP056" },
      // New on the updated sheet - the Gallon size of this already existed
      // as an exception in Class A (Gallon) below; this is its Liter sibling.
      { name: "Sweet Chami", sku: "AFP065" },
    ],
  },
  {
    category: "Premium (Liter)",
    unit: "Liter",
    products: [
      { name: "Sweet", sku: "AFP018" },
      { name: "Special", sku: "AFP019" },
      { name: "Fish Sauce", sku: "AFP020" },
      { name: "Patis Puro", sku: "AFP021" },
      { name: "Cane Vinegar White", sku: "AFP022" },
      { name: "Cane Vinegar Red", sku: "AFP023" },
      { name: "Liquid Seasoning", sku: "AFP024" },
      { name: "Premium Black for Guisado", sku: "AFP025" },
    ],
  },
  {
    // The sheet itself is inconsistent here - every other item in this
    // category is suffixed "A" but this one isn't ("Cane Vinegar Red", not
    // "Cane Vinegar Red A") - kept exactly as the sheet has it rather than
    // "fixing" what might be a real, separate product line.
    category: "Class A (Gallon)",
    unit: "Gallon",
    products: [
      { name: "Sweet A", sku: "AFP026" },
      { name: "Special A", sku: "AFP027" },
      { name: "More Sweet A", sku: "AFP028" },
      { name: "Dark Soysauce A", sku: "AFP029" },
      { name: "Fish Sauce A", sku: "AFP030" },
      { name: "Cane Vinegar White A", sku: "AFP031" },
      { name: "Cane Vinegar Red", sku: "AFP032" },
      { name: "Oyster Sauce A", sku: "AFP033" },
      { name: "Oyster Sauce Dark A", sku: "AFP034" },
      { name: "Toyo Mansi", sku: "AFP035" },
      { name: "Catsup A", sku: "AFP036" },
      { name: "Catsup for Burger", sku: "AFP037" },
      { name: "Jampong Hot Chili Sauce", sku: "AFP057" },
      { name: "Sweet Chami", sku: "AFP058" },
      { name: "Distilled Cane Vinegar White", sku: "AFP055" },
    ],
  },
  {
    category: "Premium (3.785L P.E.T.)",
    unit: "3.785 L",
    products: [
      { name: "Sweet", sku: "AFP038" },
      { name: "Special", sku: "AFP039" },
      { name: "Fish Sauce", sku: "AFP040" },
      { name: "Cane Vinegar White", sku: "AFP041" },
      { name: "Cane Vinegar Red", sku: "AFP042" },
      { name: "Liquid Seasoning", sku: "AFP043" },
    ],
  },
  {
    // New on the updated sheet - same "Liquid Seasoning" product line as
    // 350ML/Liter/Gallon/P.E.T. above, just at a size (600ML) none of those
    // came in before.
    category: "Premium (600ML)",
    unit: "600 mL bottle",
    products: [{ name: "Liquid Seasoning", sku: "AFP045" }],
  },
  {
    category: "New Products",
    unit: "Mixed (L / gal / kg)",
    products: [
      { name: "Palm Oil Liter", sku: "AFP069" },
      { name: "Palm Oil Gallon", sku: "AFP070" },
      { name: "Sukang Maligalig 750ML", sku: "AFP046" },
      { name: "Takoyaki Sauce Liter", sku: "AFP049" },
      { name: "Cassava", sku: "AFP051" },
      { name: "Retail Salt", sku: "AFP052" },
      { name: "Sack of Salt", sku: "AFP053" },
      { name: "Chili Powder 1kg", sku: "AFP067" },
      { name: "Black Pepper 1kg", sku: "AFP068" },
      { name: "Onion Powder 1kg", sku: "AFP066" },
      // New on the updated sheet.
      { name: "Toyomansi Sachet", sku: "AFP047" },
      { name: "Takoyaki Sauce Gallon", sku: "AFP048" },
      { name: "Fried Chicken Sauce Gallon", sku: "AFP054" },
    ],
  },
  {
    category: "NSC",
    unit: "-",
    products: [{ name: "Toyomansi" }],
  },
  {
    // New category on the updated sheet - the same "A" soy sauce line sold
    // by the container instead of by Liter/Gallon.
    category: "Container",
    unit: "Container",
    products: [
      { name: "Sweet A", sku: "AFP059" },
      { name: "Special A", sku: "AFP060" },
      { name: "More Sweet A", sku: "AFP061" },
      { name: "Cane Vinegar White A", sku: "AFP062" },
      { name: "Special", sku: "AFP063" },
      { name: "Toyo Mansi", sku: "AFP064" },
    ],
  },
];

async function seedProducts() {
  let sortOrder = 0;
  for (const group of PRODUCT_CATEGORIES) {
    for (const { name, sku } of group.products) {
      sortOrder += 1;
      // No natural unique key in the doc beyond name+category, so upsert by
      // hand - this is also what backfills `sku` onto a product that was
      // seeded before it existed, rather than creating a duplicate row.
      const existing = await prisma.product.findFirst({
        where: { name, category: group.category },
        select: { id: true },
      });
      if (existing) {
        await prisma.product.update({
          where: { id: existing.id },
          data: { unit: group.unit, sortOrder, ...(sku ? { sku } : {}) },
        });
      } else {
        await prisma.product.create({
          data: { name, category: group.category, unit: group.unit, sortOrder, sku },
        });
      }
    }
  }
}

async function seedUsers() {
  const defaultUsers = [
    { name: "System Administrator", username: "admin", password: "admin123", role: "SUPERVISOR_ADMIN" as const },
    { name: "Online Encoder", username: "online.encoder", password: "online123", role: "ONLINE_ENCODER" as const },
    { name: "Offline Encoder", username: "offline.encoder", password: "offline123", role: "OFFLINE_ENCODER" as const },
  ];

  for (const u of defaultUsers) {
    const existing = await prisma.user.findUnique({ where: { username: u.username } });
    if (existing) continue;
    const passwordHash = await bcrypt.hash(u.password, 10);
    await prisma.user.create({
      data: { name: u.name, username: u.username, passwordHash, role: u.role },
    });
  }
}

async function main() {
  await seedProducts();
  await seedUsers();
  // eslint-disable-next-line no-console
  console.log("Seed complete: product master list + default users loaded.");
  // eslint-disable-next-line no-console
  console.log("Default logins -> admin/admin123, online.encoder/online123, offline.encoder/offline123");
  // eslint-disable-next-line no-console
  console.log("Change these passwords before going live.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
