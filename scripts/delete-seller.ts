// Deletes a test seller by email or phone so they can re-register from scratch.
// Usage: npx tsx scripts/delete-seller.ts <email_or_phone>
// Example: npx tsx scripts/delete-seller.ts 9876543210
// Example: npx tsx scripts/delete-seller.ts test@example.com

import "dotenv/config";
import { prisma } from "../src/config/prisma";

async function main() {
  const query = process.argv[2]?.trim();
  if (!query) {
    console.error("\n❌ Error: Please provide an email or phone number to delete.");
    console.error("Usage: npx tsx scripts/delete-seller.ts <email_or_phone>\n");
    process.exit(1);
  }

  // Find seller matching email or phone
  const cleanPhone = query.replace(/\D/g, "");
  const sellers = await prisma.seller.findMany({
    where: {
      OR: [
        { email: { equals: query, mode: "insensitive" } },
        { phone: query },
        ...(cleanPhone ? [{ phone: { contains: cleanPhone } }] : []),
        ...(cleanPhone ? [{ phoneNumber: cleanPhone }] : []),
      ],
    },
    include: {
      onboarding: true,
    },
  });

  if (sellers.length === 0) {
    console.log(`\n⚠️  No seller found matching "${query}". Nothing to delete.\n`);
    return;
  }

  for (const seller of sellers) {
    console.log(`\n🗑️  Deleting seller: ${seller.businessName || "Unnamed"} | ID: ${seller.id} | Phone: ${seller.phone} | Email: ${seller.email || "N/A"}`);

    // Delete related entities that might not have cascade
    await prisma.notification.deleteMany({ where: { sellerId: seller.id } });
    await prisma.sellerSettings.deleteMany({ where: { sellerId: seller.id } });
    await prisma.sellerCommissionConfig.deleteMany({ where: { sellerId: seller.id } });
    await prisma.sellerAgreementConfig.deleteMany({ where: { sellerId: seller.id } });
    await prisma.teamMember.deleteMany({ where: { sellerId: seller.id } });
    
    // Order items & orders if test data
    const orders = await prisma.order.findMany({ where: { sellerId: seller.id }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length > 0) {
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { sellerId: seller.id } });
    }

    await prisma.return.deleteMany({ where: { product: { sellerId: seller.id } } });
    await prisma.productVariant.deleteMany({ where: { product: { sellerId: seller.id } } });
    await prisma.product.deleteMany({ where: { sellerId: seller.id } });
    await prisma.settlement.deleteMany({ where: { sellerId: seller.id } });
    await prisma.sellerOnboarding.deleteMany({ where: { sellerId: seller.id } });

    // Finally delete seller
    await prisma.seller.delete({ where: { id: seller.id } });

    console.log(`✅ Successfully deleted seller "${seller.phone}" / "${seller.email}".`);
  }

  console.log("\n🎉 Done! You can now re-test signup and onboarding with this number/email.\n");
}

main()
  .catch((e) => {
    console.error("\n❌ Failed to delete seller:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
