import { ruleFilter } from '../src/seo-pipeline/junkFilter.js';

const test = [
  'maler und lackierer kassel',
  'maler und lackierer preise',
  'maler und lackierer ausbildung kassel',
  'bmw motorrad kassel niederlassung',
  'bayer karosserie und lackierzentrum kassel',
  'gebrauchtwagen kassel und umgebung',
  'autohändler in kassel',
  'fahrradhändler kassel',
  'innung kassel',
  'maler und lackierer kasse',
  'rolltore für garagen kassel',
  'wir kaufen dein auto kassel',
  'aldi öffnungszeiten kassel',
  'autolackierung preise kassel',
  'karosserie reparatur kassel',
];

console.log('=== NON-AUTOMOTIVE provider (Maler) ===');
const r1 = ruleFilter(test, { providerCategory: 'Maler', city: 'Kassel' });
console.log('keep:');
r1.keep.forEach(k => console.log('  +', k));
console.log('reject:');
r1.reject.forEach(k => console.log('  -', k.keyword, '=>', k.reason));
console.log('borderline (LLM review):');
r1.borderline.forEach(k => console.log('  ?', k));

console.log('\n=== AUTOMOTIVE provider (Autolackiererei) ===');
const r2 = ruleFilter(test, {
  providerCategory: 'Autolackiererei',
  city: 'Kassel',
  gewerke: ['Maler und Lackierer', 'Karosserie- und Fahrzeugbauer'],
});
console.log('keep:');
r2.keep.forEach(k => console.log('  +', k));
console.log('reject:');
r2.reject.forEach(k => console.log('  -', k.keyword, '=>', k.reason));
console.log('borderline:');
r2.borderline.forEach(k => console.log('  ?', k));
