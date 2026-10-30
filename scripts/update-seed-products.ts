import 'dotenv/config';
import { prisma } from '../src/config/prisma';

async function updateSeedProducts() {
  console.log('Connecting to database...');
  
  const p1 = await prisma.product.update({
    where: { id: '22d1cfa3-af85-476d-a2c0-dcdb1630d284' },
    data: {
      name: 'Nike Air Zoom Pegasus Pro',
      brandName: 'Nike',
      category: 'Shoeswear',
      description: 'Engineered with responsive Zoom Air cushioning and breathable Flyknit mesh. Designed for supreme athletic performance, lightweight cushioning, and elite street style.',
      imageUrls: [
        'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=1000&q=90',
        'https://images.unsplash.com/photo-1608231387042-66d1773070a5?w=1000&q=90'
      ],
      mrp: 11999,
      price: 4999,
      status: 'ACTIVE',
    },
  });
  console.log('Updated P1:', p1.name);

  const p2 = await prisma.product.update({
    where: { id: '7b2ebe77-02ab-439b-9081-d3dc92958973' },
    data: {
      name: 'Fabindia Pure Linen Co-ord Set',
      brandName: 'Fabindia',
      category: 'Fashion',
      description: 'Handcrafted from 100% breathable organic linen with mother-of-pearl buttons. Tailored relaxed silhouette offering all-day elegance, luxury comfort, and timeless artisan style.',
      imageUrls: [
        'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=1000&q=90',
        'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1000&q=90'
      ],
      mrp: 4199,
      price: 3499,
      status: 'ACTIVE',
    },
  });
  console.log('Updated P2:', p2.name);

  const p3 = await prisma.product.update({
    where: { id: 'cb0fe6b0-9427-4114-bed5-68cab4ba82d9' },
    data: {
      name: 'Velvet Matte Lipstick - Ruby Noir',
      brandName: 'Aura Luxe Cosmetics',
      category: 'Cosmetic',
      description: 'Ultra-pigmented velvet matte lipstick enriched with French rosehip oil and vitamin E. Delivers 16-hour smudge-proof luxury wear without feathering or drying lips.',
      imageUrls: [
        'https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=1000&q=90',
        'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=1000&q=90'
      ],
      mrp: 1299,
      price: 499,
      status: 'ACTIVE',
    },
  });
  console.log('Updated P3:', p3.name);

  const p4 = await prisma.product.update({
    where: { id: '01c131f6-6f5d-4e3b-88dd-01cc55941720' },
    data: {
      name: 'Glow Radiance 20% Vitamin C Serum',
      brandName: 'Derma Botanics',
      category: 'Cosmetic',
      description: 'Potent 20% clinical-grade Vitamin C + Ferulic Acid anti-aging serum. Visibly brightens dull complexion, fades hyperpigmentation, and stimulates natural collagen synthesis.',
      imageUrls: [
        'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=1000&q=90',
        'https://images.unsplash.com/photo-1608248597359-2ff4eb59049a?w=1000&q=90'
      ],
      mrp: 1899,
      price: 899,
      status: 'ACTIVE',
    },
  });
  console.log('Updated P4:', p4.name);
}

updateSeedProducts()
  .then(() => console.log('ALL SEED PRODUCTS UPDATED'))
  .catch((e) => console.error('FAILED:', e))
  .finally(() => prisma.$disconnect());
