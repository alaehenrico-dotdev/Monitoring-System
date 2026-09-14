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
const PRODUCT_CATEGORIES: { category: string; unit: string; products: string[] }[] = [
  {
    category: "Premium (350ML)",
    unit: "350 mL bottle",
    products: [
      "Special",
      "Fish Sauce",
      "Cane Vinegar White",
      "Cane Vinegar Red",
      "Toyo Mansi",
      "Liquid Seasoning",
      "Premium Black for Guisado",
      "Sukang Maligalig 350ML",
    ],
  },
  {
    category: "Class A (Liter)",
    unit: "Liter",
    products: [
      "Sweet A",
      "Special A",
      "More Sweet A",
      "Dark Soysauce A",
      "Fish Sauce A",
      "Cane Vinegar White A",
      "Oyster Sauce A",
      "Oyster Sauce Dark A",
      "Toyo Mansi",
      "Catsup A",
      "Catsup for Burger",
      "Jampong Hot Chili Sauce",
    ],
  },
  {
    category: "Premium (Liter)",
    unit: "Liter",
    products: [
      "Sweet",
      "Special",
      "Fish Sauce",
      "Patis Puro",
      "Cane Vinegar White",
      "Cane Vinegar Red",
      "Liquid Seasoning",
      "Premium Black for Guisado",
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
      "Sweet A",
      "Special A",
      "More Sweet A",
      "Dark Soysauce A",
      "Fish Sauce A",
      "Cane Vinegar White A",
      "Cane Vinegar Red",
      "Oyster Sauce A",
      "Oyster Sauce Dark A",
      "Toyo Mansi",
      "Catsup A",
      "Catsup for Burger",
      "Jampong Hot Chili Sauce",
      "Sweet Chami",
      "Distilled Cane Vinegar White",
    ],
  },
  {
    category: "Premium (3.785L P.E.T.)",
    unit: "3.785 L",
    products: ["Sweet", "Special", "Fish Sauce", "Cane Vinegar White", "Cane Vinegar Red", "Liquid Seasoning"],
  },
  {
    category: "New Products",
    unit: "Mixed (L / gal / kg)",
    products: [
      "Palm Oil Liter",
      "Palm Oil Gallon",
      "Sukang Maligalig 750ML",
      "Takoyaki Sauce Liter",
      "Cassava",
      "Retail Salt",
      "Sack of Salt",
      "Chili Powder 1kg",
      "Black Pepper 1kg",
      "Onion Powder 1kg",
    ],
  },
  {
    category: "NSC",
    unit: "-",
    products: ["Toyomansi"],
  },
];

async function seedProducts() {
  let sortOrder = 0;
  for (const group of PRODUCT_CATEGORIES) {
    for (const name of group.products) {
      sortOrder += 1;
      // No natural unique key in the doc beyond name+category, so upsert by hand.
      const existing = await prisma.product.findFirst({
        where: { name, category: group.category },
        select: { id: true },
      });
      if (existing) {
        await prisma.product.update({
          where: { id: existing.id },
          data: { unit: group.unit, sortOrder },
        });
      } else {
        await prisma.product.create({
          data: { name, category: group.category, unit: group.unit, sortOrder },
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
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
