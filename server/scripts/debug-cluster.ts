import mongoose from 'mongoose';
import { config } from '../src/config.js';

async function main() {
  await mongoose.connect(config.mongoUri);
  const k = mongoose.connection.collection('sc_keywords');

  const terms = ['fahrzeuglackierung', 'maler und lackierer', 'karosserie- und fahrzeugbauer'];
  const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regs = escaped.map(e => new RegExp('^' + e + '$', 'i'));
  console.log('regexes:', regs.map(r => r.toString()));

  const q: any = {
    category: { $in: regs },
    city: { $regex: new RegExp('^Kassel', 'i') },
  };

  const docs = await k.find(q).limit(5).toArray();
  console.log('multi-term matched:', docs.length);
  docs.forEach(d => console.log('  -', d.keyword, '| cat:', d.category, '| score:', d.opportunityScore));

  const exactN = await k.countDocuments({ category: 'maler und lackierer', city: 'Kassel' });
  console.log('exact (maler und lackierer / Kassel):', exactN);

  // Sample keyword from collection
  const sample = await k.findOne({ category: 'maler und lackierer' });
  console.log('sample keyword doc:', JSON.stringify(sample, null, 2).slice(0, 500));

  await mongoose.disconnect();
}

main();
