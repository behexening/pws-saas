#!/usr/bin/env node
/**
 * Create the 6 akFISHinfo pricing products + recurring prices in Stripe
 * TEST mode, then print an .env block with the resulting price IDs.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/create-test-products.js
 *
 * Safety: refuses to run if STRIPE_SECRET_KEY is a live key (sk_live_*).
 * Idempotent-ish: looks up an existing product by name before creating,
 * but always creates a fresh price (Stripe prices are immutable).
 */

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('ERROR: STRIPE_SECRET_KEY is not set.');
  process.exit(1);
}
if (!key.startsWith('sk_test_')) {
  console.error('ERROR: Refusing to run with a non-test key. Use sk_test_... only.');
  process.exit(1);
}

const stripe = require('stripe')(key);

// Stripe does not support 14-day intervals natively, so biweekly is
// interval='week' with interval_count=2. Season is a 5-month plan billed once.
const PLANS = [
  { envVar: 'STRIPE_PRICE_EA_BIWEEKLY', name: 'Early Adopter Biweekly Plan', desc: 'Early adopter biweekly plan for access to akFISHinfo', amount: 3000,  interval: 'week',  interval_count: 2 },
  { envVar: 'STRIPE_PRICE_EA_MONTHLY',  name: 'Early Adopter Monthly Plan',  desc: 'Early adopter monthly plan for access to akFISHinfo',  amount: 5000,  interval: 'month', interval_count: 1 },
  { envVar: 'STRIPE_PRICE_EA_SEASON',   name: 'Early Adopter Season Plan',   desc: 'Early adopter seasonal plan for access to akFISHinfo', amount: 24000, interval: 'month', interval_count: 5 },
  { envVar: 'STRIPE_PRICE_BIWEEKLY',    name: 'Biweekly Plan',               desc: 'Biweekly plan for access to akFISHinfo',                amount: 5000,  interval: 'week',  interval_count: 2 },
  { envVar: 'STRIPE_PRICE_MONTHLY',     name: 'Monthly Plan',                desc: 'Monthly plan for access to akFISHinfo',                 amount: 8400,  interval: 'month', interval_count: 1 },
  { envVar: 'STRIPE_PRICE_SEASON',      name: 'Season Plan',                 desc: 'Seasonal plan for access to akFISHinfo',                amount: 40000, interval: 'month', interval_count: 5 },
];

async function findOrCreateProduct({ name, desc }) {
  let starting_after;
  while (true) {
    const page = await stripe.products.list({ limit: 100, active: true, starting_after });
    const hit = page.data.find(p => p.name === name);
    if (hit) return hit;
    if (!page.has_more) break;
    starting_after = page.data[page.data.length - 1].id;
  }
  return stripe.products.create({ name, description: desc });
}

async function createPrice(productId, plan) {
  return stripe.prices.create({
    product: productId,
    currency: 'usd',
    unit_amount: plan.amount,
    recurring: { interval: plan.interval, interval_count: plan.interval_count },
    nickname: plan.name,
    lookup_key: 'akfish_' + plan.envVar.toLowerCase().replace(/^stripe_price_/, ''),
    transfer_lookup_key: true,
  });
}

(async () => {
  const results = [];
  for (const plan of PLANS) {
    process.stderr.write(`• ${plan.name} ... `);
    const product = await findOrCreateProduct(plan);
    const price = await createPrice(product.id, plan);
    results.push({ envVar: plan.envVar, productId: product.id, priceId: price.id, amount: plan.amount });
    process.stderr.write(`ok (product=${product.id}, price=${price.id})\n`);
  }

  console.log('\n# --- paste into Railway (test env) or .env.test ---');
  for (const r of results) console.log(`${r.envVar}=${r.priceId}`);
  console.log('\n# Products (for reference):');
  for (const r of results) console.log(`#   ${r.envVar}: product=${r.productId}  price=${r.priceId}  $${(r.amount/100).toFixed(2)}`);
})().catch(err => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
