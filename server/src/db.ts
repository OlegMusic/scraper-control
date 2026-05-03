import mongoose, { Schema } from 'mongoose';
import { config } from './config.js';

export async function connectDb() {
  await mongoose.connect(config.mongoUri);
  console.log(`[db] connected: ${config.mongoUri}`);
}

// ── Schemas (минимальные, только наши коллекции) ──────────────────────────

const jobSchema = new Schema({
  scraperFile: { type: String, required: true }, // напр. "scrape-handwerker-radar.ts"
  args: { type: [String], default: [] },         // CLI аргументы
  cron: { type: String },                         // напр. "0 6 * * *" — null = on-demand
  enabled: { type: Boolean, default: true },
  label: { type: String },                        // дружественное имя ("Утренний радар-проход")
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() },
}, { collection: 'sc_jobs' });

const runSchema = new Schema({
  jobId: { type: Schema.Types.ObjectId, ref: 'sc_jobs' },
  scraperFile: { type: String, required: true },
  args: { type: [String], default: [] },
  pid: { type: Number },
  startedAt: { type: Date, default: () => new Date() },
  endedAt: { type: Date },
  exitCode: { type: Number },
  exitReason: { type: String }, // 'completed' | 'killed' | 'crashed'
  logPath: { type: String },
  status: { type: String, default: 'running' }, // 'running' | 'completed' | 'failed' | 'killed'
}, { collection: 'sc_runs' });

const personaSchema = new Schema({
  name: { type: String, required: true },
  country: { type: String, default: 'de' },     // ISO-2: de, us...
  city: { type: String },                        // optional, для заметки
  proxySessionId: { type: String, required: true }, // зафиксирован → один и тот же IP
  proxyLifetime: { type: String, default: '24h' },  // максимум sticky lifetime
  profileDir: { type: String, required: true },     // постоянный Chrome profile dir
  notes: { type: String },                          // например "мой немецкий Google account"
  legitimacyConfirmed: { type: Boolean, default: false }, // юзер подтверждает что персона легитимна
  createdAt: { type: Date, default: () => new Date() },
  lastUsedAt: { type: Date },
}, { collection: 'sc_personas' });

export const Job = mongoose.model('Job', jobSchema);
export const Run = mongoose.model('Run', runSchema);
export const Persona = mongoose.model('Persona', personaSchema);
