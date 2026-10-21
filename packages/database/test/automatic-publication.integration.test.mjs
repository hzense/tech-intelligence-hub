import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import process from 'node:process';
import pg from 'pg';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import {
  saveEditorialSignal,
  readEditorialSignal,
  readEditorialSignalStatuses,
} from '../src/editorial-signal-store.mjs';
import { editorialUnifiedContent } from '../src/unified-signal-plan.mjs';

const url = process.env.MIGRATION_TEST_ADMIN_URL;
if (url) validateConnectionTarget({ connectionString: url, profile: 'local-test' });
const suite = url ? describe.sequential : describe.skip;
suite('automatic publication: pinned opt-in and append-only post-publication changes', () => {
  const name = `hzense_auto_publication_${process.pid}_${Date.now()}`;
  let admin,
    pool,
    created = false;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    const target = new URL(url);
    target.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: target.toString(), max: 4 });
    const dir = new URL('../../../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort())
      await pool.query(await readFile(new URL(file, dir), 'utf8'));
    await pool.query(
      "UPDATE unified_signal_cutover SET ready=true,plan_hash=repeat('a',64); INSERT INTO topics(id,title,runtime_enabled,status) VALUES('ai','AI',true,'watching')",
    );
  }, 60000);
  afterAll(async () => {
    await pool?.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin?.end();
  });
  async function fixture({ pinned = true, sourceUrls = ['https://example.com/news'] } = {}) {
    const id = randomUUID();
    const content = {
      title: 'Generated title',
      summary: 'Generated summary',
      eventDate: '2026-10-21',
      dateBasis: 'source_published',
      signalType: 'product',
      organizations: ['Example'],
      persons: ['Researcher'],
      topics: [{ id: 'ai', title: 'AI' }],
      sourceUrls,
    };
    const snapshot = pinned
      ? { publication: { mode: 'automatic', policy: 'auto-publication-v1', sourceUrls } }
      : {};
    await pool.query(
      `INSERT INTO signal_generation_runs(id,owner_id,batch_id,item_id,source_fence,source_hash,profile_id,profile_revision,generation_version,fingerprint,snapshot,configuration,status,result)
      VALUES($1,'owner',$1,$1,1,$2,$1,1,'test',$2,$3,'{}','completed',$4)`,
      [
        id,
        'a'.repeat(64),
        snapshot,
        {
          classification: 'private',
          candidates: [{ index: 0, title: content.title, summary: content.summary }],
        },
      ],
    );
    const material = {
      materialHash: 'b'.repeat(64),
      title: content.title,
      summary: content.summary,
      dateBasis: content.dateBasis,
      sourceUrls,
    };
    return {
      pool,
      owner: 'owner',
      automatic: true,
      unified: true,
      material,
      request: {
        requestId: randomUUID(),
        runId: id,
        candidateIndex: 0,
        expectedRevision: 0,
        materialHash: material.materialHash,
        action: 'publish',
        content,
        consent: false,
      },
    };
  }
  it('publishes once with truthful basis in audit, unified and public projections', async () => {
    const args = await fixture();
    const [one, two] = await Promise.all([saveEditorialSignal(args), saveEditorialSignal(args)]);
    expect(one).toEqual(two);
    expect(one.publication_basis).toBe('automatic_checks');
    const rows = (
      await pool.query(
        'SELECT publication_basis,content FROM unified_public_signals WHERE signal_id=$1',
        [
          `editorial-${(await pool.query("SELECT md5($1||':0') AS id", [args.request.runId])).rows[0].id}`,
        ],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].publication_basis).toBe('automatic_checks');
    expect(rows[0].content.title).toBe(args.request.content.title);
    const statuses = await readEditorialSignalStatuses({
      pool,
      owner: 'owner',
      runIds: [args.request.runId],
    });
    expect(statuses[0].candidates[0].publication_basis).toBe('automatic_checks');
  });
  it('supports genuine manual text edits and withdrawal without auto overwriting or resurrecting', async () => {
    const args = await fixture();
    await saveEditorialSignal(args);
    const edited = { ...args.request.content, title: 'Edited title', summary: 'Edited summary' };
    await saveEditorialSignal({
      ...args,
      automatic: false,
      request: {
        ...args.request,
        requestId: randomUUID(),
        expectedRevision: 1,
        content: edited,
        consent: true,
      },
    });
    await expect(
      saveEditorialSignal({ ...args, request: { ...args.request, requestId: randomUUID() } }),
    ).rejects.toThrow('revision_conflict');
    const withdrawn = await saveEditorialSignal({
      ...args,
      automatic: false,
      request: {
        ...args.request,
        requestId: randomUUID(),
        expectedRevision: 2,
        action: 'withdraw',
        content: edited,
        consent: true,
      },
    });
    expect(withdrawn.content.title).toBe('Edited title');
    expect(withdrawn.publication_basis).toBe('manual_confirmation');
    // A replay acknowledges the original write but cannot create a new revision.
    expect((await saveEditorialSignal(args)).revision).toBe(1);
    expect(
      (
        await readEditorialSignal({
          pool,
          owner: 'owner',
          runId: args.request.runId,
          candidateIndex: 0,
        })
      ).action,
    ).toBe('withdraw');
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM editorial_public_signals WHERE signal_id=$1',
          [
            `editorial-${(await pool.query("SELECT md5($1||':0') AS id", [args.request.runId])).rows[0].id}`,
          ],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('serializes competing request IDs so only one publication can commit', async () => {
    const args = await fixture();
    const results = await Promise.allSettled([
      saveEditorialSignal(args),
      saveEditorialSignal({ ...args, request: { ...args.request, requestId: randomUUID() } }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')[0].reason.code).toBe('revision_conflict');
  });
  it('does not upgrade historical tasks or overwrite human drafts', async () => {
    await expect(saveEditorialSignal(await fixture({ pinned: false }))).rejects.toThrow(
      'automatic_publication_not_authorized',
    );
    const args = await fixture();
    await saveEditorialSignal({
      ...args,
      automatic: false,
      request: { ...args.request, requestId: randomUUID(), action: 'draft' },
    });
    await expect(saveEditorialSignal(args)).rejects.toThrow('revision_conflict');
  });
  it('rejects missing dates, changed automatic text, unapproved sources, forged request flags and lost ownership', async () => {
    const args = await fixture();
    for (const content of [
      { ...args.request.content, eventDate: null },
      { ...args.request.content, title: 'Injected' },
      { ...args.request.content, sourceUrls: ['https://private.example/file'] },
    ])
      await expect(
        saveEditorialSignal({ ...args, request: { ...args.request, content } }),
      ).rejects.toBeDefined();
    await expect(
      saveEditorialSignal({
        ...args,
        automatic: false,
        request: { ...args.request, automatic: true },
      }),
    ).rejects.toThrow('invalid_request');
    await expect(saveEditorialSignal({ ...args, owner: 'intruder' })).rejects.toThrow('not_found');
    await expect(saveEditorialSignal(await fixture({ sourceUrls: [] }))).rejects.toThrow(
      'automatic_publication_source_invalid',
    );
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM editorial_signal_revisions WHERE run_id=$1',
          [args.request.runId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('enforces pinned task and original text against direct SQL bypass', async () => {
    for (const pinned of [false, true]) {
      const args = await fixture({ pinned });
      const content = pinned
        ? { ...args.request.content, summary: 'Forged output' }
        : args.request.content;
      await expect(
        pool.query(
          `INSERT INTO editorial_signal_revisions(request_id,run_id,owner_id,candidate_index,revision,material_hash,action,content,request_hash,unified_content,publication_basis)
        VALUES($1,$2,'owner',0,1,$3,'publish',$4,$3,$5,'automatic_checks')`,
          [
            args.request.requestId,
            args.request.runId,
            'b'.repeat(64),
            content,
            editorialUnifiedContent(content),
          ],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }
  });
  it('does not turn an automatic no-match preview into permission to duplicate a new catalog match', async () => {
    const args = await fixture();
    const resource = {
      type: 'company',
      name: 'Example',
      introduction: 'Example company',
      event_role: 'Developer',
      evidence: [{ fragment_id: 'f1', quote: 'Example launches' }],
    };
    args.material.resources = [resource];
    args.material.resourceSourceOptions = [
      { name: 'Example', type: 'company', sourceUrls: args.request.content.sourceUrls },
    ];
    args.request.content = {
      ...args.request.content,
      persons: [],
      resources: [{ ...resource, entity_id: '__new__' }],
    };
    // Another publication inserts a matching organization after our preview.
    await pool.query(
      "INSERT INTO entities(id,type,name,status) VALUES('concurrent-example','company','Example','active')",
    );
    await expect(saveEditorialSignal(args)).rejects.toThrow('resource_identity_ambiguous');
    expect(
      (await pool.query("SELECT count(*)::int AS n FROM entities WHERE name='Example'")).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM editorial_signal_revisions WHERE run_id=$1',
          [args.request.runId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
});
