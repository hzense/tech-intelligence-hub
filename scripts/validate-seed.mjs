import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const load = async (name) => parse(await readFile(resolve('data/seed', name), 'utf8'));
const topics = await load('topics.yaml'); const entities = await load('entities.yaml'); const sources = await load('sources.yaml'); const relations = await load('relations.yaml'); const signals = await load('signals.yaml');
const ids = new Set();
for (const item of [...topics, ...entities, ...sources, ...relations, ...signals]) { if (ids.has(item.id)) throw new Error(`Duplicate id: ${item.id}`); ids.add(item.id); }
const topicIds = new Set(topics.map((x)=>x.id)); const entityIds = new Set(entities.map((x)=>x.id)); const sourceIds = new Set(sources.map((x)=>x.id));
for (const relation of relations) { if (!entityIds.has(relation.source) || !entityIds.has(relation.target)) throw new Error(`Broken relation: ${relation.id}`); }
for (const signal of signals) { if (!sourceIds.has(signal.source_id)) throw new Error(`Unknown source: ${signal.id}`); for (const topic of signal.topics ?? []) if (!topicIds.has(topic)) throw new Error(`Unknown topic ${topic} in ${signal.id}`); for (const entity of signal.entities ?? []) if (!entityIds.has(entity)) throw new Error(`Unknown entity ${entity} in ${signal.id}`); }
console.log(`Seed validation OK: ${topics.length} topics, ${entities.length} entities, ${relations.length} relations, ${signals.length} signals.`);
