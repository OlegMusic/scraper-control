import axios from 'axios';
import { io, Socket } from 'socket.io-client';

export const api = axios.create({ baseURL: '/api' });

let _socket: Socket | null = null;
export function socket(): Socket {
  if (_socket) return _socket;
  _socket = io({ path: '/socket.io' });
  return _socket;
}

export interface ScraperInfo {
  file: string;
  category: 'scrape' | 'enrich' | 'extract' | 'import' | 'other';
  description: string;
  argHints: string[];
  fullPath: string;
}

export interface ActiveRun {
  runId: string;
  scraperFile: string;
  args: string[];
  pid: number;
  startedAt: string;
}

export interface RunRecord {
  _id: string;
  scraperFile: string;
  args: string[];
  pid?: number;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  exitReason?: string;
  status: string;
}

export interface JobRecord {
  _id: string;
  scraperFile: string;
  args: string[];
  cron?: string;
  enabled: boolean;
  label?: string;
}
