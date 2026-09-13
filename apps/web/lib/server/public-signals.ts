import 'server-only';

import { connection } from 'next/server';
import {
  readRuntimePublicSignals,
  readRuntimePublicSignalById,
  searchRuntimePublicSignals,
} from './runtime-reader';

// Never cache these calls. Withdrawals and dependency revocations must be
// observed on the next request, across every public entry point.
export async function waitForPublicSignalRequest() {
  await connection();
}
export async function getPublicSignals() {
  await waitForPublicSignalRequest();
  return readRuntimePublicSignals();
}
export async function getPublicSignalById(id: string) {
  await waitForPublicSignalRequest();
  return readRuntimePublicSignalById(id);
}
export async function searchPublicSignals(query: string) {
  await waitForPublicSignalRequest();
  return searchRuntimePublicSignals(query);
}
