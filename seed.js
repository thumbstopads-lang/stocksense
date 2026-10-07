// Seeds 5 demo business accounts (kirana, pharmacy, cafe, salon, hardware),
// each with its own tailored categories, suppliers, items and custom fields.
// Idempotent: skips any account whose email already exists.
// Disable with SEED_DEMO_ACCOUNTS=0.
const { get, insertReturningId, run } = require('./db');
const { hashPassword } = require('./auth');

const DEMOS = [
  {
    email: 'kirana@demo', password: 'kirana123', businessName: 'Sharma Kirana Store',
    categories: ['Grains & Pulses', 'Oils & Ghee', 'Spices', 'Beverages', 'Household'],
    suppliers: [{ name: 'FreshFarm Distributors', phone: '9820011111' }, { name: 'City Wholesale Mart', phone: '9820022222' }],
    customFields: [{ key: 'gst_pct', label: 'GST %', type: 'number' }, { key: 'shelf', label: 'Shelf', type: 'text' }],
    items: [
      { name: 'Basmati Rice 5kg', sku: 'KIR-RICE5', qty: 18, reorderLevel: 8, costPrice: 420, category: 'Grains & Pulses', supplier: 'FreshFarm Distributors', custom: { gst_pct: 5, shelf: 'A-1' } },
      { name: 'Toor Dal 1kg', sku: 'KIR-DAL1', qty: 6, reorderLevel: 10, costPrice: 145, category: 'Grains & Pulses', supplier: 'FreshFarm Distributors', custom: { gst_pct: 5, shelf: 'A-1' } },
      { name: 'Sunflower Oil 1L', sku: 'KIR-OIL1', qty: 4, reorderLevel: 12, costPrice: 135, category: 'Oils & Ghee', supplier: 'City Wholesale Mart', custom: { gst_pct: 5, shelf: 'A-2' } },
      { name: 'Tea 250g', sku: 'KIR-TEA250', qty: 22, reorderLevel: 9, costPrice: 140, category: 'Beverages', supplier: 'City Wholesale Mart', custom: { gst_pct: 5, shelf: 'B-1' } },
      { name: 'Sugar 1kg', sku: 'KIR-SUG1', qty: 15, reorderLevel: 10, costPrice: 45, category: 'Grains & Pulses', supplier: 'FreshFarm Distributors', custom: { gst_pct: 5, shelf: 'A-2' } },
      { name: 'Turmeric Powder 200g', sku: 'KIR-TUR200', qty: 30, reorderLevel: 12, costPrice: 58, category: 'Spices', supplier: 'City Wholesale Mart', custom: { gst_pct: 5, shelf: 'B-2' } },
      { name: 'Filter Coffee 500g', sku: 'KIR-COF500', qty: 0, reorderLevel: 6, costPrice: 310, category: 'Beverages', supplier: 'City Wholesale Mart', custom: { gst_pct: 5, shelf: 'B-1' } },
      { name: 'Wheat Flour 10kg', sku: 'KIR-ATT10', qty: 9, reorderLevel: 5, costPrice: 480, category: 'Grains & Pulses', supplier: 'FreshFarm Distributors', custom: { gst_pct: 5, shelf: 'A-3' } },
      { name: 'Detergent Powder 1kg', sku: 'KIR-DET1', qty: 14, reorderLevel: 8, costPrice: 118, category: 'Household', supplier: 'City Wholesale Mart', custom: { gst_pct: 18, shelf: 'C-1' } },
    ],
  },
  {
    email: 'pharmacy@demo', password: 'pharmacy123', businessName: 'CityCare Pharmacy',
    categories: ['Tablets', 'Syrups', 'First Aid', 'Personal Care'],
    suppliers: [{ name: 'MediSupply Co.', phone: '9830033333' }],
    customFields: [{ key: 'expiry', label: 'Expiry date', type: 'text' }, { key: 'batch', label: 'Batch no.', type: 'text' }],
    items: [
      { name: 'Paracetamol 650mg (15 tabs)', sku: 'MED-PARA650', qty: 120, reorderLevel: 40, costPrice: 32, category: 'Tablets', supplier: 'MediSupply Co.', custom: { expiry: '2027-08', batch: 'P2411' } },
      { name: 'Azithromycin 500mg (5 tabs)', sku: 'MED-AZI500', qty: 45, reorderLevel: 20, costPrice: 89, category: 'Tablets', supplier: 'MediSupply Co.', custom: { expiry: '2027-03', batch: 'A1180' } },
      { name: 'Cough Syrup 100ml', sku: 'MED-COU100', qty: 18, reorderLevel: 10, costPrice: 95, category: 'Syrups', supplier: 'MediSupply Co.', custom: { expiry: '2027-12', batch: 'C5521' } },
      { name: 'Bandage Roll 10cm', sku: 'MED-BAN10', qty: 60, reorderLevel: 25, costPrice: 22, category: 'First Aid', supplier: 'MediSupply Co.', custom: { expiry: '2028-01', batch: 'B9902' } },
      { name: 'Antiseptic Liquid 100ml', sku: 'MED-ANT100', qty: 25, reorderLevel: 12, costPrice: 98, category: 'First Aid', supplier: 'MediSupply Co.', custom: { expiry: '2027-06', batch: 'D4417' } },
      { name: 'ORS Sachets (21.8g)', sku: 'MED-ORS21', qty: 80, reorderLevel: 30, costPrice: 18, category: 'First Aid', supplier: 'MediSupply Co.', custom: { expiry: '2027-11', batch: 'O3320' } },
      { name: 'Digital Thermometer', sku: 'MED-THE01', qty: 12, reorderLevel: 5, costPrice: 180, category: 'First Aid', supplier: 'MediSupply Co.', custom: { expiry: '-', batch: 'T7712' } },
      { name: 'Hand Sanitizer 200ml', sku: 'MED-SAN200', qty: 30, reorderLevel: 15, costPrice: 75, category: 'Personal Care', supplier: 'MediSupply Co.', custom: { expiry: '2027-02', batch: 'S2210' } },
    ],
  },
  {
    email: 'cafe@demo', password: 'cafe123', businessName: 'Brew & Bean Cafe',
    categories: ['Coffee & Tea', 'Dairy', 'Disposables', 'Syrups'],
    suppliers: [{ name: 'Coorg Coffee Estate', phone: '9840044444' }, { name: 'DailyDairy Farm', phone: '9840055555' }],
    customFields: [{ key: 'unit_size', label: 'Unit size', type: 'text' }, { key: 'storage', label: 'Storage', type: 'text' }],
    items: [
      { name: 'Arabica Beans 1kg', sku: 'CAF-ARA1', qty: 8, reorderLevel: 4, costPrice: 850, category: 'Coffee & Tea', supplier: 'Coorg Coffee Estate', custom: { unit_size: '1kg bag', storage: 'Airtight' } },
      { name: 'Milk 1L', sku: 'CAF-MLK1', qty: 20, reorderLevel: 10, costPrice: 62, category: 'Dairy', supplier: 'DailyDairy Farm', custom: { unit_size: '1L', storage: 'Fridge' } },
      { name: 'Paper Cups 100pc', sku: 'CAF-CUP100', qty: 5, reorderLevel: 3, costPrice: 240, category: 'Disposables', supplier: 'Coorg Coffee Estate', custom: { unit_size: '100 pc', storage: 'Dry shelf' } },
      { name: 'Sugar Sachets 500pc', sku: 'CAF-SUG500', qty: 3, reorderLevel: 2, costPrice: 180, category: 'Disposables', supplier: 'DailyDairy Farm', custom: { unit_size: '500 pc', storage: 'Dry shelf' } },
      { name: 'Vanilla Syrup 750ml', sku: 'CAF-VAN750', qty: 6, reorderLevel: 3, costPrice: 320, category: 'Syrups', supplier: 'Coorg Coffee Estate', custom: { unit_size: '750ml', storage: 'Room temp' } },
      { name: 'Tea Bags 100pc', sku: 'CAF-TEA100', qty: 10, reorderLevel: 5, costPrice: 210, category: 'Coffee & Tea', supplier: 'Coorg Coffee Estate', custom: { unit_size: '100 pc', storage: 'Airtight' } },
      { name: 'Cocoa Powder 500g', sku: 'CAF-COC500', qty: 7, reorderLevel: 3, costPrice: 380, category: 'Coffee & Tea', supplier: 'Coorg Coffee Estate', custom: { unit_size: '500g', storage: 'Airtight' } },
      { name: 'Napkins 500pc', sku: 'CAF-NAP500', qty: 9, reorderLevel: 4, costPrice: 150, category: 'Disposables', supplier: 'DailyDairy Farm', custom: { unit_size: '500 pc', storage: 'Dry shelf' } },
    ],
  },
  {
    email: 'salon@demo', password: 'salon123', businessName: 'Glamour Salon',
    categories: ['Hair Care', 'Skin Care', 'Tools', 'Disposables'],
    suppliers: [{ name: 'BeautyPro Distributors', phone: '9850066666' }],
    customFields: [{ key: 'brand', label: 'Brand', type: 'text' }, { key: 'size', label: 'Size', type: 'text' }],
    items: [
      { name: 'Shampoo 1L', sku: 'SAL-SHA1L', qty: 10, reorderLevel: 4, costPrice: 450, category: 'Hair Care', supplier: 'BeautyPro Distributors', custom: { brand: 'LuxePro', size: '1L' } },
      { name: 'Hair Color 60ml', sku: 'SAL-COL60', qty: 25, reorderLevel: 10, costPrice: 180, category: 'Hair Care', supplier: 'BeautyPro Distributors', custom: { brand: 'ColorMax', size: '60ml' } },
      { name: 'Face Pack 500g', sku: 'SAL-FAC500', qty: 8, reorderLevel: 4, costPrice: 520, category: 'Skin Care', supplier: 'BeautyPro Distributors', custom: { brand: 'HerbGlow', size: '500g' } },
      { name: 'Pro Scissors', sku: 'SAL-SCI01', qty: 6, reorderLevel: 2, costPrice: 890, category: 'Tools', supplier: 'BeautyPro Distributors', custom: { brand: 'SteelEdge', size: '6 inch' } },
      { name: 'White Towels', sku: 'SAL-TOW01', qty: 40, reorderLevel: 15, costPrice: 120, category: 'Disposables', supplier: 'BeautyPro Distributors', custom: { brand: 'SoftLine', size: 'Standard' } },
      { name: 'Hair Dryer 2000W', sku: 'SAL-DRY01', qty: 4, reorderLevel: 2, costPrice: 1450, category: 'Tools', supplier: 'BeautyPro Distributors', custom: { brand: 'AirStyle', size: '2000W' } },
      { name: 'Wax Strips 100pc', sku: 'SAL-WAX100', qty: 15, reorderLevel: 8, costPrice: 260, category: 'Disposables', supplier: 'BeautyPro Distributors', custom: { brand: 'SilkStrip', size: '100 pc' } },
    ],
  },
  {
    email: 'hardware@demo', password: 'hardware123', businessName: 'Gupta Hardware Store',
    categories: ['Tools', 'Fasteners', 'Paint', 'Electrical'],
    suppliers: [{ name: 'Industrial Tools Co.', phone: '9860077777' }],
    customFields: [{ key: 'brand', label: 'Brand', type: 'text' }, { key: 'warranty', label: 'Warranty', type: 'text' }],
    items: [
      { name: 'Claw Hammer', sku: 'HDW-HAM01', qty: 15, reorderLevel: 6, costPrice: 320, category: 'Tools', supplier: 'Industrial Tools Co.', custom: { brand: 'ForgeKing', warranty: '1 yr' } },
      { name: 'Screwdriver Set 6pc', sku: 'HDW-SCR06', qty: 20, reorderLevel: 8, costPrice: 450, category: 'Tools', supplier: 'Industrial Tools Co.', custom: { brand: 'ForgeKing', warranty: '1 yr' } },
      { name: 'Screws 100pc', sku: 'HDW-SCW100', qty: 50, reorderLevel: 20, costPrice: 90, category: 'Fasteners', supplier: 'Industrial Tools Co.', custom: { brand: 'GripTite', warranty: '-' } },
      { name: 'Wall Paint 1L', sku: 'HDW-PAI1L', qty: 25, reorderLevel: 10, costPrice: 280, category: 'Paint', supplier: 'Industrial Tools Co.', custom: { brand: 'ColorShield', warranty: '-' } },
      { name: 'LED Bulb 9W', sku: 'HDW-LED9W', qty: 60, reorderLevel: 25, costPrice: 110, category: 'Electrical', supplier: 'Industrial Tools Co.', custom: { brand: 'BrightVolt', warranty: '2 yr' } },
      { name: 'Measuring Tape 5m', sku: 'HDW-TAP5M', qty: 30, reorderLevel: 12, costPrice: 140, category: 'Tools', supplier: 'Industrial Tools Co.', custom: { brand: 'TrueMeasure', warranty: '6 mo' } },
      { name: 'Drill Machine 500W', sku: 'HDW-DRL500', qty: 5, reorderLevel: 2, costPrice: 2400, category: 'Tools', supplier: 'Industrial Tools Co.', custom: { brand: 'PowerPro', warranty: '1 yr' } },
    ],
  },
];

async function seedDemoAccounts() {
  for (const d of DEMOS) {
    if (await get('SELECT id FROM users WHERE email = ?', d.email)) continue;
    const uid = await insertReturningId(
      'INSERT INTO users (email, password_hash, business_name) VALUES (?, ?, ?)',
      d.email, hashPassword(d.password), d.businessName
    );
    await run('INSERT INTO settings (user_id, business_name, currency, custom_fields) VALUES (?, ?, ?, ?)',
      uid, d.businessName, 'INR', JSON.stringify(d.customFields));
    const catIds = {};
    for (const c of d.categories) {
      catIds[c] = await insertReturningId('INSERT INTO categories (user_id, name) VALUES (?, ?)', uid, c);
    }
    const supIds = {};
    for (const s of d.suppliers) {
      supIds[s.name] = await insertReturningId('INSERT INTO suppliers (user_id, name, phone) VALUES (?, ?, ?)', uid, s.name, s.phone || '');
    }
    for (const it of d.items) {
      const itemId = await insertReturningId(
        `INSERT INTO items (user_id, name, sku, category_id, supplier_id, qty, reorder_level, unit, cost_price, custom_fields)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        uid, it.name, it.sku || '', catIds[it.category] ?? null, supIds[it.supplier] ?? null,
        it.qty, it.reorderLevel, it.unit || 'pcs', it.costPrice || 0, JSON.stringify(it.custom || {})
      );
      if (it.qty > 0) {
        await run('INSERT INTO movements (user_id, item_id, delta, reason, qty_after) VALUES (?, ?, ?, ?, ?)',
          uid, itemId, it.qty, 'Opening stock', it.qty);
      }
    }
    console.log(`Seeded demo business: ${d.businessName} (${d.email} / ${d.password})`);
  }
}

module.exports = { seedDemoAccounts, DEMOS: DEMOS.map(({ email, businessName }) => ({ email, businessName })) };
