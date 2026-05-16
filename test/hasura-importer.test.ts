import * as assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { parseArgs, runHasuraImportCli } from '../src/cli/import-hasura-to-zmodel.js';
import {
    introspectPostgresSource,
    loadHasuraMetadata,
    normalizeIntrospection,
    renderZModel,
    translatePermission,
    translateToIntermediateModel,
} from '../src/hasura-importer.js';

const fixtureDir = path.join(process.cwd(), 'test/fixtures/hasura-importer');

function makeIntrospection() {
    return normalizeIntrospection({
        objects: [
            { schema_name: 'public', object_name: 'users', relkind: 'r' },
            { schema_name: 'public', object_name: 'posts', relkind: 'r' },
            { schema_name: 'reporting', object_name: 'user_stats', relkind: 'v' },
            { schema_name: 'reporting', object_name: 'orphan_view', relkind: 'v' },
        ],
        columns: [
            {
                schema_name: 'public',
                table_name: 'users',
                column_name: 'id',
                ordinal_position: 1,
                is_nullable: 'NO',
                data_type: 'uuid',
                udt_name: 'uuid',
                column_default: 'gen_random_uuid()',
                is_identity: 'NO',
            },
            {
                schema_name: 'public',
                table_name: 'users',
                column_name: 'email',
                ordinal_position: 2,
                is_nullable: 'NO',
                data_type: 'text',
                udt_name: 'text',
                column_default: null,
                is_identity: 'NO',
            },
            {
                schema_name: 'public',
                table_name: 'posts',
                column_name: 'id',
                ordinal_position: 1,
                is_nullable: 'NO',
                data_type: 'bigint',
                udt_name: 'int8',
                column_default: null,
                is_identity: 'YES',
            },
            {
                schema_name: 'public',
                table_name: 'posts',
                column_name: 'author_id',
                ordinal_position: 2,
                is_nullable: 'NO',
                data_type: 'uuid',
                udt_name: 'uuid',
                column_default: null,
                is_identity: 'NO',
            },
            {
                schema_name: 'public',
                table_name: 'posts',
                column_name: 'title',
                ordinal_position: 3,
                is_nullable: 'NO',
                data_type: 'text',
                udt_name: 'text',
                column_default: null,
                is_identity: 'NO',
            },
            {
                schema_name: 'reporting',
                table_name: 'user_stats',
                column_name: 'user_id',
                ordinal_position: 1,
                is_nullable: 'NO',
                data_type: 'uuid',
                udt_name: 'uuid',
                column_default: null,
                is_identity: 'NO',
            },
            {
                schema_name: 'reporting',
                table_name: 'user_stats',
                column_name: 'post_count',
                ordinal_position: 2,
                is_nullable: 'NO',
                data_type: 'bigint',
                udt_name: 'int8',
                column_default: null,
                is_identity: 'NO',
            },
            {
                schema_name: 'reporting',
                table_name: 'orphan_view',
                column_name: 'label',
                ordinal_position: 1,
                is_nullable: 'YES',
                data_type: 'text',
                udt_name: 'text',
                column_default: null,
                is_identity: 'NO',
            },
        ],
        primaryKeys: [
            {
                schema_name: 'public',
                table_name: 'users',
                constraint_name: 'users_pkey',
                column_name: 'id',
                ordinal_position: 1,
            },
            {
                schema_name: 'public',
                table_name: 'posts',
                constraint_name: 'posts_pkey',
                column_name: 'id',
                ordinal_position: 1,
            },
        ],
        uniques: [
            {
                schema_name: 'reporting',
                table_name: 'user_stats',
                constraint_name: 'user_stats_user_id_key',
                column_name: 'user_id',
                ordinal_position: 1,
            },
        ],
        foreignKeys: [
            {
                schema_name: 'public',
                table_name: 'posts',
                constraint_name: 'posts_author_id_fkey',
                column_name: 'author_id',
                referenced_schema: 'public',
                referenced_table: 'users',
                referenced_column: 'id',
                ordinal_position: 1,
            },
        ],
    });
}

test('loads tracked tables, views, relationships, and permissions from Hasura metadata', async () => {
    const loaded = await loadHasuraMetadata(fixtureDir);
    assert.equal(loaded.sourceName, 'default');
    assert.equal(loaded.entities.length, 4);

    const users = loaded.entities.find((entity) => entity.target.schema === 'public' && entity.target.name === 'users');
    assert.ok(users);
    assert.deepEqual(users.relationships.map((relation) => relation.name), ['posts']);
    assert.deepEqual(
        users.permissions.map((permission) => `${permission.role}:${permission.operation}`),
        ['user:read', 'admin:create']
    );
});

test('normalizes Postgres introspection rows into entities, keys, and relations', () => {
    const introspected = makeIntrospection();
    const posts = introspected.entities.find((entity) => entity.target.name === 'posts');
    assert.ok(posts);
    assert.equal(posts.modelName, 'PublicPosts');
    assert.deepEqual(posts.primaryKey, ['id']);
    assert.equal(posts.columns.find((field) => field.name === 'author_id')?.zmodelName, 'authorId');
    assert.equal(posts.columns.find((field) => field.name === 'id')?.defaultExpression, '@default(autoincrement())');
    assert.equal(posts.relations[0]?.targetModel, 'PublicUsers');
});

test('supports introspection through a queryable without a live Postgres server', async () => {
    const fakeQueryable = {
        async query(sql: string) {
            if (sql.includes('from pg_class')) {
                return { rows: [{ schema_name: 'public', object_name: 'users', relkind: 'r' }] };
            }
            if (sql.includes('from information_schema.columns')) {
                return {
                    rows: [
                        {
                            schema_name: 'public',
                            table_name: 'users',
                            column_name: 'id',
                            ordinal_position: 1,
                            is_nullable: 'NO',
                            data_type: 'uuid',
                            udt_name: 'uuid',
                            column_default: null,
                            is_identity: 'NO',
                        },
                    ],
                };
            }
            return { rows: [] };
        },
    };

    const introspected = await introspectPostgresSource({ queryable: fakeQueryable });
    assert.equal(introspected.entities.length, 1);
    assert.equal(introspected.entities[0]?.modelName, 'PublicUsers');
});

test('translates supported Hasura permission expressions into ZenStack policies', () => {
    const introspected = makeIntrospection();
    const posts = introspected.entities.find((entity) => entity.target.name === 'posts');
    assert.ok(posts);

    const translated = translatePermission(posts, {
        role: 'user',
        operation: 'update',
        filter: {
            author_id: {
                _eq: 'X-Hasura-User-Id',
            },
        },
        check: {
            title: {
                _neq: '',
            },
        },
        columns: ['title'],
    });

    assert.equal(
        translated.policy,
        `@@allow('update', auth().role == 'user' && authorId == auth().id)`
    );
    assert.ok(translated.todos.some((todo) => todo.includes('column-level update permission columns')));
    assert.ok(translated.todos.some((todo) => todo.includes('update.check')));
});

test('renders a deterministic ZModel with imported views, policies, TODOs, and summary', async () => {
    const loaded = await loadHasuraMetadata(fixtureDir);
    const result = translateToIntermediateModel(loaded, makeIntrospection());
    const rendered = renderZModel(result);

    assert.match(rendered, /model PublicUsers \{/);
    assert.match(rendered, /id String @id @default\(uuid\(\)\)/);
    assert.match(rendered, /author PublicUsers @relation\("posts_author_id_fkey", fields: \[authorId\], references: \[id\]\)/);
    assert.match(rendered, /model ReportingUserStats \{/);
    assert.match(rendered, /@@deny\('create, update, delete', true\)/);
    assert.match(rendered, /Imported from a Hasura-tracked view/);
    assert.match(rendered, /TODO tracked view reporting\.orphan_view could not be rendered as a model/);
    assert.match(rendered, /@@allow\('read', auth\(\)\.role == 'user' && id == auth\(\)\.id\)/);
    assert.match(rendered, /unsupported_operators: /);
});

test('captures real-world style TODOs for unsupported list relation permission predicates', async () => {
    const loaded = await loadHasuraMetadata(fixtureDir);
    const result = translateToIntermediateModel(loaded, makeIntrospection());
    const posts = result.entities.find((entity) => entity.modelName === 'PublicPosts');
    assert.ok(posts);
    assert.ok(posts.todos.some((todo) => todo.includes('update.check')));

    const users = result.entities.find((entity) => entity.modelName === 'PublicUsers');
    assert.ok(users);
    assert.ok(users.policies.some((policy) => policy.includes(`auth().role == 'admin'`)));
});

test('CLI parser supports repeated schema filters and boolean include-views overrides', () => {
    const parsed = parseArgs([
        '--metadata-dir',
        './metadata',
        '--database-url',
        'postgres://example',
        '--schema-filter',
        'public,reporting',
        '--schema-filter',
        'audit',
        '--include-views',
        'false',
        '--stdout',
    ]);

    assert.equal(parsed.metadataDir, './metadata');
    assert.equal(parsed.databaseUrl, 'postgres://example');
    assert.deepEqual(parsed.schemaFilter, ['public', 'reporting', 'audit']);
    assert.equal(parsed.includeViews, false);
    assert.equal(parsed.stdout, true);
});

test('CLI parser recognizes help flags', () => {
    assert.equal(parseArgs(['--help']).help, true);
    assert.equal(parseArgs(['-h']).help, true);
});

test('CLI prints help without requiring other arguments', async () => {
    let output = '';
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
        output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
        return true;
    }) as typeof process.stdout.write;

    try {
        await runHasuraImportCli(['--help']);
    } finally {
        process.stdout.write = originalWrite;
    }

    assert.match(output, /Usage: zenstack-graphql-hasura-import/);
    assert.match(output, /--metadata-dir <dir>/);
});

test('CLI requires either --out or --stdout before attempting import', async () => {
    await assert.rejects(
        runHasuraImportCli(['--metadata-dir', fixtureDir, '--database-url', 'postgres://example']),
        /--out is required unless --stdout is used/
    );
});
