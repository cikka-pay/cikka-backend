import "dotenv/config";
import { PrismaClient, ProductStatus } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:Vedant%40123@localhost:5432/cikka_dashboard?schema=public",
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const REAL_APPROVED_PRODUCTS = [
  // 1. Electronics (4)
  {
    name: "iPhone 16 Pro Max 256GB Titanium",
    sku: "ELEC-IP16PM-256",
    category: "Electronics",
    brandName: "Apple",
    description: "Forged in Grade 5 titanium with the industry-leading A18 Pro chip, 48MP Fusion camera system, and exceptional battery life.",
    mrp: 154900,
    price: 144900,
    stockQty: 45,
    loyaltyPoints: 1500,
    imageUrls: [
      "https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=1000&q=90",
      "https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },
  {
    name: "Sony WH-1000XM5 Wireless Noise Cancelling Headphones",
    sku: "ELEC-SONY-WH1000M5",
    category: "Electronics",
    brandName: "Sony",
    description: "Industry-leading noise cancellation with two processors and 8 microphones. High-Resolution Audio with LDAC and 30-hour battery life.",
    mrp: 34990,
    price: 29990,
    stockQty: 30,
    loyaltyPoints: 1000,
    imageUrls: [
      "https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=1000&q=90",
      "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },
  {
    name: "MacBook Pro 14\" M3 Space Black",
    sku: "ELEC-MBP14-M3-BLK",
    category: "Electronics",
    brandName: "Apple",
    description: "Supercharged by M3 chip with next-generation GPU architecture, stunning Liquid Retina XDR display, and up to 22 hours of battery life.",
    mrp: 179900,
    price: 169900,
    stockQty: 20,
    loyaltyPoints: 2000,
    imageUrls: [
      "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },
  {
    name: "Dyson Zone Absolute Noise Cancelling Audio",
    sku: "ELEC-DYSON-ZONE-ABS",
    category: "Electronics",
    brandName: "Dyson",
    description: "Advanced noise cancellation engineered for ultra-low distortion and pure sound across the audible frequency range with contact-free purification.",
    mrp: 64900,
    price: 59900,
    stockQty: 18,
    loyaltyPoints: 1200,
    imageUrls: [
      "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },

  // 2. Shoeswear (4)
  {
    name: "Air Jordan 1 Retro High OG Chicago",
    sku: "SHOE-AJ1-RETRO-CHI",
    category: "Shoeswear",
    brandName: "Nike",
    description: "The iconic silhouette crafted in premium full-grain leather with encapsulated Nike Air cushioning and legendary Chicago color blocking.",
    mrp: 24995,
    price: 21995,
    stockQty: 25,
    loyaltyPoints: 1000,
    imageUrls: [
      "https://images.unsplash.com/photo-1552346154-21d32810aba3?w=1000&q=90",
      "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },
  {
    name: "Nike Air Zoom Pegasus 40 Pro",
    sku: "SHOE-NIKE-PEG40-PRO",
    category: "Shoeswear",
    brandName: "Nike",
    description: "Springy ride for any run with responsive Zoom Air units and engineered mesh upper for ultra-breathable comfort.",
    mrp: 13995,
    price: 11495,
    stockQty: 50,
    loyaltyPoints: 800,
    imageUrls: [
      "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },
  {
    name: "Adidas Originals Yeezy Boost 350 V2",
    sku: "SHOE-ADIDAS-YZY-350",
    category: "Shoeswear",
    brandName: "Adidas",
    description: "Re-engineered Primeknit upper with distinctive center stitching, heel tab, and full-length Boost midsole providing unmatched responsiveness.",
    mrp: 29999,
    price: 24999,
    stockQty: 15,
    loyaltyPoints: 1200,
    imageUrls: [
      "https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },
  {
    name: "Christian Louboutin Kate 100 Leather Pumps",
    sku: "SHOE-CL-KATE-100",
    category: "Shoeswear",
    brandName: "Christian Louboutin",
    description: "Iconic signature red lacquered soles crafted in Paris from supple Italian calfskin leather with a slender 100mm stiletto heel.",
    mrp: 85000,
    price: 78500,
    stockQty: 12,
    loyaltyPoints: 2500,
    imageUrls: [
      "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },

  // 3. Fashion (4)
  {
    name: "Fabindia Pure Mulberry Silk Kurta Set",
    sku: "FASH-FAB-SILK-KRT",
    category: "Fashion",
    brandName: "Fabindia",
    description: "Handwoven pure mulberry silk kurta with intricate zardozi embroidery detailing along the neckline, paired with tailored silk pants.",
    mrp: 15999,
    price: 12999,
    stockQty: 35,
    loyaltyPoints: 700,
    imageUrls: [
      "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },
  {
    name: "Sabyasachi Heritage Royal Embroidered Sherwani",
    sku: "FASH-SABYA-ROYAL-SHR",
    category: "Fashion",
    brandName: "Sabyasachi",
    description: "Masterpiece artisanal sherwani handcrafted in Bengal raw silk with antique gold dabka and resham floral embroidery.",
    mrp: 210000,
    price: 185000,
    stockQty: 8,
    loyaltyPoints: 5000,
    imageUrls: [
      "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },
  {
    name: "Zara Premium Tailored Wool Blazer",
    sku: "FASH-ZARA-WOOL-BLZ",
    category: "Fashion",
    brandName: "Zara",
    description: "Italian spun virgin wool blazer cut in a relaxed double-breasted silhouette with peak lapels and horn buttons.",
    mrp: 10990,
    price: 8990,
    stockQty: 40,
    loyaltyPoints: 500,
    imageUrls: [
      "https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },
  {
    name: "Ralph Lauren Classic Oxford Cotton Shirt",
    sku: "FASH-RL-OXFORD-BLU",
    category: "Fashion",
    brandName: "Ralph Lauren",
    description: "The quintessential American button-down woven from 100% long-staple combed cotton featuring the embroidered multicolour pony at the chest.",
    mrp: 16500,
    price: 14500,
    stockQty: 30,
    loyaltyPoints: 750,
    imageUrls: [
      "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },

  // 4. Cosmetic & Fragrance (4)
  {
    name: "Dior Sauvage Elixir Parfum 100ml",
    sku: "COSM-DIOR-SAUVAGE-ELX",
    category: "Cosmetic",
    brandName: "Dior Beauty",
    description: "An extraordinarily concentrated fragrance steeped in the iconic freshness of Sauvage with an intoxicating heart of spices and rich wood essences.",
    mrp: 21500,
    price: 18900,
    stockQty: 28,
    loyaltyPoints: 900,
    imageUrls: [
      "https://images.unsplash.com/photo-1523293182086-7651a899d37f?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },
  {
    name: "Dyson Airwrap Multi-Styler Complete Long",
    sku: "COSM-DYSON-AIRWRAP-CMP",
    category: "Cosmetic",
    brandName: "Dyson",
    description: "Re-engineered barrels utilize enhanced Coanda airflow to curl and style without extreme heat damage, keeping hair smooth and shiny.",
    mrp: 54900,
    price: 49900,
    stockQty: 22,
    loyaltyPoints: 1500,
    imageUrls: [
      "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },
  {
    name: "Estée Lauder Advanced Night Repair Serum 50ml",
    sku: "COSM-ESTEE-ANR-50",
    category: "Cosmetic",
    brandName: "Estée Lauder",
    description: "Deep and fast-penetrating face serum infused with Chronolux Power Signal Technology to reduce the look of multiple signs of aging.",
    mrp: 13000,
    price: 11500,
    stockQty: 40,
    loyaltyPoints: 600,
    imageUrls: [
      "https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },
  {
    name: "Tom Ford Black Orchid Eau De Parfum 100ml",
    sku: "COSM-TF-BLACK-ORCHID",
    category: "Cosmetic",
    brandName: "Tom Ford",
    description: "A luxurious and sensual fragrance of rich, dark accords and an alluring potion of black orchids and spice, creating an unforgettable aura.",
    mrp: 22000,
    price: 19500,
    stockQty: 18,
    loyaltyPoints: 950,
    imageUrls: [
      "https://images.unsplash.com/photo-1588405748880-12d1d2a59f75?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },

  // 5. Watches (4)
  {
    name: "Rolex Submariner Date Oystersteel 41mm",
    sku: "WTCH-ROLEX-SUB-41",
    category: "Watches",
    brandName: "Rolex",
    description: "The benchmark of divers' watches crafted in Oystersteel with a unidirectional rotatable Cerachrom bezel and solid-link Oyster bracelet.",
    mrp: 995000,
    price: 945000,
    stockQty: 5,
    loyaltyPoints: 10000,
    imageUrls: [
      "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },
  {
    name: "Omega Seamaster Diver 300M Co-Axial Master",
    sku: "WTCH-OMEGA-SEA-300M",
    category: "Watches",
    brandName: "Omega",
    description: "Celebrated maritime heritage powered by Master Chronometer Calibre 8800 with laser-engraved wave dial and helium escape valve.",
    mrp: 520000,
    price: 485000,
    stockQty: 7,
    loyaltyPoints: 6000,
    imageUrls: [
      "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },
  {
    name: "TAG Heuer Carrera Chronograph Automatic",
    sku: "WTCH-TAG-CARRERA-CHR",
    category: "Watches",
    brandName: "TAG Heuer",
    description: "Born on the racetrack, featuring the Calibre Heuer 02 automatic movement, blue sunray brushed dial, and steel H-shaped bracelet.",
    mrp: 350000,
    price: 320000,
    stockQty: 10,
    loyaltyPoints: 4500,
    imageUrls: [
      "https://images.unsplash.com/photo-1547996160-71dfa6358268?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },
  {
    name: "Cartier Santos de Cartier Large Steel",
    sku: "WTCH-CARTIER-SANTOS-L",
    category: "Watches",
    brandName: "Cartier",
    description: "Geometric square dial with visible bezel screws, mechanical movement with automatic winding 1847 MC, and interchangeable SmartLink bracelet.",
    mrp: 720000,
    price: 680000,
    stockQty: 6,
    loyaltyPoints: 8000,
    imageUrls: [
      "https://images.unsplash.com/photo-1533139502658-0198f920d8e8?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },

  // 6. Luxury Bags (4)
  {
    name: "Louis Vuitton Neverfull MM Monogram Canvas",
    sku: "BAG-LV-NEVERFULL-MM",
    category: "Bags",
    brandName: "Louis Vuitton",
    description: "Timeless tote bag combining historic details with comfortable cowhide handles and a removable zippered clutch in iconic coated canvas.",
    mrp: 180000,
    price: 165000,
    stockQty: 14,
    loyaltyPoints: 4000,
    imageUrls: [
      "https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },
  {
    name: "Gucci GG Marmont Matelassé Shoulder Bag",
    sku: "BAG-GUCCI-MARMONT-MD",
    category: "Bags",
    brandName: "Gucci",
    description: "Softly structured chain shoulder bag in chevron matelassé leather with Double G hardware and microfiber lining with a suede-like finish.",
    mrp: 160000,
    price: 145000,
    stockQty: 16,
    loyaltyPoints: 3500,
    imageUrls: [
      "https://images.unsplash.com/photo-1591561954557-26941169b49e?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },
  {
    name: "Prada Re-Edition 2005 Saffiano Leather Bag",
    sku: "BAG-PRADA-RE2005-SAF",
    category: "Bags",
    brandName: "Prada",
    description: "Crafted in iconic crosshatch Saffiano leather featuring the enameled metal triangle logo, detachable pouch, and woven tape shoulder strap.",
    mrp: 215000,
    price: 195000,
    stockQty: 12,
    loyaltyPoints: 4200,
    imageUrls: [
      "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },
  {
    name: "Bottega Veneta Cassette Intrecciato Leather Bag",
    sku: "BAG-BV-CASSETTE-INT",
    category: "Bags",
    brandName: "Bottega Veneta",
    description: "Crossbody bag crafted in padded double-face Intrecciato leather weave with an adjustable shoulder strap and magnetic closure.",
    mrp: 245000,
    price: 225000,
    stockQty: 9,
    loyaltyPoints: 4800,
    imageUrls: [
      "https://images.unsplash.com/photo-1566150905458-1bf1fc113f0d?w=1000&q=90",
    ],
    status: ProductStatus.ACTIVE,
  },
];

async function main() {
  console.log("=========================================");
  console.log("PURGING DUMMY TEST PRODUCTS & SEEDING 24 APPROVED PRODUCTS");
  console.log("=========================================");

  // 1. Delete all dummy products ("Return Prod", "Variant Prod", "Low Stock Prod", "High Stock Prod", "Product 1")
  const dummyNames = [
    "Return Prod",
    "Variant Prod",
    "Low Stock Prod",
    "High Stock Prod",
    "Product 1",
  ];

  // Delete matching reviews & variants first for referential integrity
  const dummyProducts = await prisma.product.findMany({
    where: {
      OR: [
        { name: { in: dummyNames } },
        { name: { contains: "dummy", mode: "insensitive" } },
        { name: { contains: "test prod", mode: "insensitive" } },
        { sku: { contains: "TEST", mode: "insensitive" } },
      ],
    },
  });

  console.log(`Found ${dummyProducts.length} dummy test products to delete.`);

  for (const dp of dummyProducts) {
    try {
      await prisma.productReview.deleteMany({ where: { productId: dp.id } });
      await prisma.productVariant.deleteMany({ where: { productId: dp.id } });
      await prisma.orderItem.deleteMany({ where: { productId: dp.id } });
      await prisma.product.delete({ where: { id: dp.id } });
      console.log(`Deleted dummy product: [${dp.id}] ${dp.name}`);
    } catch (err: any) {
      console.warn(`Could not delete ${dp.name}: ${err.message}`);
    }
  }

  // 2. Fetch or create a verified luxury seller
  let seller = await prisma.seller.findFirst({
    where: { onboardingStatus: "VERIFIED" },
  });

  if (!seller) {
    seller = await prisma.seller.findFirst();
  }

  if (!seller) {
    seller = await prisma.seller.create({
      data: {
        phone: "+919876543210",
        businessName: "Cikka Luxury Boutique",
        phoneVerified: true,
        onboardingStatus: "VERIFIED",
      },
    });
  }

  console.log(`Assigning 24 approved products to seller: ${seller.businessName} (${seller.id})`);

  // 3. Upsert each of the 24 approved products
  let createdCount = 0;
  let updatedCount = 0;

  for (const item of REAL_APPROVED_PRODUCTS) {
    const existing = await prisma.product.findUnique({
      where: { sku: item.sku },
    });

    if (existing) {
      await prisma.product.update({
        where: { id: existing.id },
        data: {
          name: item.name,
          category: item.category,
          brandName: item.brandName,
          description: item.description,
          mrp: item.mrp,
          price: item.price,
          stockQty: item.stockQty,
          loyaltyPoints: item.loyaltyPoints,
          imageUrls: item.imageUrls,
          status: ProductStatus.ACTIVE,
        },
      });
      updatedCount++;
    } else {
      await prisma.product.create({
        data: {
          sellerId: seller.id,
          sku: item.sku,
          name: item.name,
          category: item.category,
          brandName: item.brandName,
          description: item.description,
          mrp: item.mrp,
          price: item.price,
          stockQty: item.stockQty,
          loyaltyPoints: item.loyaltyPoints,
          imageUrls: item.imageUrls,
          status: ProductStatus.ACTIVE,
        },
      });
      createdCount++;
    }
  }

  console.log(`Seeding complete: ${createdCount} created, ${updatedCount} updated.`);

  const finalActive = await prisma.product.findMany({
    where: { status: ProductStatus.ACTIVE },
    select: { id: true, name: true, category: true, price: true, status: true },
    orderBy: { category: "asc" },
  });

  console.log(`=========================================`);
  console.log(`TOTAL ACTIVE PRODUCTS NOW IN DATABASE: ${finalActive.length}`);
  finalActive.forEach((p, idx) => {
    console.log(`${idx + 1}. [${p.category}] ${p.name} - ₹${p.price}`);
  });
  console.log(`=========================================`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

