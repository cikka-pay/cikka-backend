import 'dotenv/config';
import { prisma } from '../src/config/prisma';

async function publishAllPendingProducts() {
  console.log('Connecting to database and fetching pending products...');

  const pendingCount = await prisma.product.count({
    where: { status: 'PENDING_APPROVAL' },
  });

  console.log(`Found ${pendingCount} products currently in PENDING_APPROVAL.`);

  if (pendingCount > 0) {
    const updated = await prisma.product.updateMany({
      where: { status: 'PENDING_APPROVAL' },
      data: { status: 'ACTIVE' },
    });
    console.log(`Successfully updated ${updated.count} products to ACTIVE.`);
  } else {
    console.log('No products in PENDING_APPROVAL found.');
  }

  const allActive = await prisma.product.count({
    where: { status: 'ACTIVE' },
  });
  const total = await prisma.product.count();
  console.log(`Total products: ${total}, Total Active products: ${allActive}`);
}

publishAllPendingProducts()
  .then(() => console.log('Done.'))
  .catch((err) => console.error('Error publishing products:', err))
  .finally(() => prisma.$disconnect());
