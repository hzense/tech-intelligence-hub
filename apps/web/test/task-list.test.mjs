import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterAndSortTasks } from '../lib/task-list.ts';

const rows = Object.freeze([
  { id: 'z1', name: '资料 10', model: 'GPT', status: 'completed', date: 300, cost: 100 },
  { id: 'a2', name: '资料 2', model: 'DeepSeek', status: 'failed', date: 100, cost: 5 },
  { id: 'b3', name: '机器人发布', model: 'DeepSeek', status: 'running', date: 200, cost: null },
  { id: 'c4', name: '机器人研究', model: 'DeepSeek', status: 'completed', date: 200, cost: 0 },
]);
const base = {
  query: '',
  status: 'all',
  searchText: (row) => `${row.name} ${row.id} ${row.model}`,
  statusValue: (row) => row.status,
  sortValue: (row) => row.date,
  direction: 'desc',
};
const ids = (overrides = {}) =>
  filterAndSortTasks(rows, { ...base, ...overrides }).map((row) => row.id);

test('task filtering combines status with case-insensitive name, model and ID terms', () => {
  assert.deepEqual(ids({ query: '  机器人  dEePsEeK ', status: 'completed' }), ['c4']);
  assert.deepEqual(ids({ query: 'Ａ２' }), ['a2']);
  assert.deepEqual(ids({ query: 'not loaded' }), []);
  assert.deepEqual(ids({ query: '机器人', status: 'failed' }), []);
});

test('task sorting is stable and never mutates input order or task objects', () => {
  assert.deepEqual(ids(), ['z1', 'b3', 'c4', 'a2']);
  assert.deepEqual(ids({ direction: 'asc' }), ['a2', 'b3', 'c4', 'z1']);
  assert.deepEqual(
    rows.map((row) => row.id),
    ['z1', 'a2', 'b3', 'c4'],
  );
  assert.equal(filterAndSortTasks(rows, base)[0], rows[0]);
});

test('numeric expense and natural text sorting keep unknown values last in either direction', () => {
  assert.deepEqual(ids({ sortValue: (row) => row.cost, direction: 'asc' }), [
    'c4',
    'a2',
    'z1',
    'b3',
  ]);
  assert.deepEqual(ids({ sortValue: (row) => row.cost }), ['z1', 'a2', 'c4', 'b3']);
  assert.deepEqual(ids({ query: '资料', sortValue: (row) => row.name, direction: 'asc' }), [
    'a2',
    'z1',
  ]);
  assert.deepEqual(ids({ sortValue: (row) => (row.id === 'z1' ? Number.NaN : row.date) }), [
    'b3',
    'c4',
    'a2',
    'z1',
  ]);
});
