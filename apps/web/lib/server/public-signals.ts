import 'server-only';

import { connection } from 'next/server';
import { getEditorialSignals, getEditorialSignalById } from './editorial-signals';
import { searchSignalEntries } from '../editorial-signal-reader-core';
import { compareSearchResults } from '@hzense/search/ranking';
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
  const [current, editorial] = await Promise.all([
    readRuntimePublicSignals(),
    getEditorialSignals(),
  ]);
  return [...current.filter((entry) => !entry.id.startsWith('editorial-')), ...editorial].sort(
    (left, right) => right.occurred_at.localeCompare(left.occurred_at),
  );
}
export async function getPublicSignalById(id: string) {
  await waitForPublicSignalRequest();
  return id.startsWith('editorial-') ? getEditorialSignalById(id) : readRuntimePublicSignalById(id);
}
export async function searchPublicSignals(query: string) {
  await waitForPublicSignalRequest();
  const [current, editorial] = await Promise.all([
    searchRuntimePublicSignals(query),
    getEditorialSignals(),
  ]);
  return [
    ...current.filter((entry) => !entry.id.startsWith('editorial-')),
    ...searchSignalEntries(editorial, query),
  ].sort(compareSearchResults);
}
