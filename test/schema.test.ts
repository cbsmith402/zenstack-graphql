import assert from 'node:assert/strict';
import test from 'node:test';

import { createZenStackGraphQLSchema, graphql, printSchema } from '../src/index.js';
import type { ModelDelegate, ZenStackClientLike } from '../src/index.js';
import { createInMemoryClient, schema } from './helpers.js';

function toPlain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

type MutationDelegate = Required<Pick<ModelDelegate, 'create' | 'update'>>;
type TransactionTestClient = Omit<ZenStackClientLike, '$transaction'> & {
    User: MutationDelegate;
    user: MutationDelegate;
    $transaction: {
        <T>(operations: Promise<T>[]): Promise<T[]>;
        <T>(callback: (tx: TransactionTestClient) => Promise<T>): Promise<T>;
    };
};

test('generates Hasura-style root fields and types', async () => {
    const { client } = createInMemoryClient();
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        getClient: async () => client,
    });

    const printed = printSchema(graphqlSchema);
    assert.match(printed, /users\(where:/);
    assert.match(printed, /users_by_pk\(id: Int!/);
    assert.match(printed, /users_aggregate\(where:/);
    assert.match(printed, /insert_users\(objects:/);
    assert.match(printed, /insert_users_one\(object: User_insert_input!, on_conflict: User_on_conflict\)/);
    assert.match(printed, /update_users\(where:/);
    assert.match(printed, /delete_users_by_pk\(id: Int!/);
    assert.match(printed, /type User/);
    assert.match(printed, /input User_bool_exp/);
});

test('executes nested reads and aggregates with Hasura-like args', async () => {
    const { client } = createInMemoryClient();
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        getClient: async () => client,
    });

    const result = await graphql({
        schema: graphqlSchema,
        source: `
            query {
                users(where: { age: { _gte: 18 } }, order_by: [{ age: desc }], limit: 1) {
                    id
                    name
                    posts(order_by: [{ id: asc }]) {
                        id
                        title
                    }
                }
                users_aggregate(where: { role: { _eq: ADMIN } }) {
                    aggregate {
                        count
                        avg {
                            age
                        }
                        max {
                            age
                        }
                    }
                    nodes {
                        id
                        name
                    }
                }
            }
        `,
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual(toPlain(result.data), {
        users: [
            {
                id: 1,
                name: 'Ada',
                posts: [
                    { id: 10, title: 'ZenStack Intro' },
                    { id: 11, title: 'Hasura Notes' },
                ],
            },
        ],
        users_aggregate: {
            aggregate: {
                count: 1,
                avg: { age: 34 },
                max: { age: 34 },
            },
            nodes: [{ id: 1, name: 'Ada' }],
        },
    });
});

test('supports distinct_on, aggregate count args, and relation aggregate fields', async () => {
    const { client } = createInMemoryClient();
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        getClient: async () => client,
    });

    const result = await graphql({
        schema: graphqlSchema,
        source: `
            query {
                posts(distinct_on: [authorId], order_by: [{ authorId: asc }, { views: desc }]) {
                    id
                    title
                    authorId
                    views
                }
                posts_aggregate {
                    aggregate {
                        count
                        distinct_authors: count(columns: [authorId], distinct: true)
                    }
                }
                users_by_pk(id: 1) {
                    id
                    posts_aggregate(order_by: [{ views: desc }]) {
                        aggregate {
                            count
                            sum {
                                views
                            }
                            max {
                                views
                            }
                        }
                        nodes {
                            id
                            title
                            views
                        }
                    }
                }
            }
        `,
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual(toPlain(result.data), {
        posts: [
            { id: 11, title: 'Hasura Notes', authorId: 1, views: 8 },
            { id: 12, title: 'GraphQL Adapter', authorId: 2, views: 13 },
        ],
        posts_aggregate: {
            aggregate: {
                count: 3,
                distinct_authors: 2,
            },
        },
        users_by_pk: {
            id: 1,
            posts_aggregate: {
                aggregate: {
                    count: 2,
                    sum: { views: 13 },
                    max: { views: 8 },
                },
                nodes: [
                    { id: 11, title: 'Hasura Notes', views: 8 },
                    { id: 10, title: 'ZenStack Intro', views: 5 },
                ],
            },
        },
    });
});

test('executes insert, update, and delete mutations', async () => {
    const { client, store } = createInMemoryClient();
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        getClient: async () => client,
    });

    const mutation = await graphql({
        schema: graphqlSchema,
        source: `
            mutation {
                insert_users_one(object: { id: 3, name: "Cara", age: 25, role: USER }) {
                    id
                    name
                    age
                    role
                }
                update_users(where: { id: { _eq: 2 } }, _set: { name: "Benny" }, _inc: { age: 1 }) {
                    affected_rows
                    returning {
                        id
                        name
                        age
                    }
                }
                delete_users_by_pk(id: 1) {
                    id
                    name
                }
            }
        `,
    });

    assert.equal(mutation.errors, undefined);
    assert.deepEqual(toPlain(mutation.data), {
        insert_users_one: {
            id: 3,
            name: 'Cara',
            age: 25,
            role: 'USER',
        },
        update_users: {
            affected_rows: 1,
            returning: [{ id: 2, name: 'Benny', age: 20 }],
        },
        delete_users_by_pk: {
            id: 1,
            name: 'Ada',
        },
    });
    assert.deepEqual(
        store.users.map((user) => user.id).sort((left, right) => left - right),
        [2, 3]
    );
});

test('supports nested inserts and insert_one on_conflict upserts', async () => {
    const { client, store } = createInMemoryClient();
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        getClient: async () => client,
    });

    const result = await graphql({
        schema: graphqlSchema,
        source: `
            mutation {
                insert_users_one(
                    object: {
                        name: "Cara"
                        age: 25
                        role: USER
                        posts: {
                            data: [
                                { title: "Nested One", views: 2 }
                                { title: "Nested Two", views: 7 }
                            ]
                        }
                    }
                ) {
                    id
                    name
                    posts(order_by: [{ views: desc }]) {
                        id
                        title
                        views
                    }
                }
                upsert_user: insert_users_one(
                    object: { id: 2, name: "Benny", age: 21, role: USER }
                    on_conflict: {
                        constraint: User_pkey
                        update_columns: [name, age]
                    }
                ) {
                    id
                    name
                    age
                    role
                }
            }
        `,
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual(toPlain(result.data), {
        insert_users_one: {
            id: 3,
            name: 'Cara',
            posts: [
                { id: 14, title: 'Nested Two', views: 7 },
                { id: 13, title: 'Nested One', views: 2 },
            ],
        },
        upsert_user: {
            id: 2,
            name: 'Benny',
            age: 21,
            role: 'USER',
        },
    });
    assert.equal(store.users.find((user) => user.id === 2)?.name, 'Benny');
    assert.equal(store.posts.filter((post) => post.authorId === 3).length, 2);
});

test('invokes hooks and normalizes auth-like errors', async () => {
    const calls: string[] = [];
    const { client } = createInMemoryClient();
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        getClient: async (context: { deny?: boolean }) => {
            if (context.deny) {
                throw Object.assign(new Error('denied'), { name: 'ZenStackAuthError' });
            }
            return client;
        },
        hooks: {
            beforeResolve(invocation) {
                calls.push(`before:${invocation.fieldName}`);
            },
            afterResolve(_result, invocation) {
                calls.push(`after:${invocation.fieldName}`);
            },
        },
    });

    const success = await graphql({
        schema: graphqlSchema,
        source: '{ users { id } }',
        contextValue: {},
    });

    assert.equal(success.errors, undefined);
    assert.deepEqual(calls, ['before:users', 'after:users']);

    const denied = await graphql({
        schema: graphqlSchema,
        source: '{ users { id } }',
        contextValue: { deny: true },
    });

    assert.equal(denied.data, null);
    assert.equal(denied.errors?.[0]?.extensions?.code, 'FORBIDDEN');
});

test('omits insensitive mode for sqlite-backed string filters', async () => {
    let capturedWhere: unknown;
    const graphqlSchema = createZenStackGraphQLSchema({
        schema: {
            provider: { type: 'sqlite' },
            ...schema,
        },
        getClient: async () => ({
            User: {
                async findMany(args?: Record<string, unknown>) {
                    capturedWhere = args?.where;
                    return [];
                },
            },
            user: {
                async findMany(args?: Record<string, unknown>) {
                    capturedWhere = args?.where;
                    return [];
                },
            },
        }),
    });

    const result = await graphql({
        schema: graphqlSchema,
        source: `
            query {
                users(where: { name: { _ilike: "%Ada%" } }) {
                    id
                }
            }
        `,
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual(capturedWhere, {
        name: {
            contains: 'Ada',
        },
    });
});

test('preserves null ordering directives in compiled orderBy args', async () => {
    let capturedOrderBy: unknown;
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        getClient: async () => ({
            User: {
                async findMany(args?: Record<string, unknown>) {
                    capturedOrderBy = args?.orderBy;
                    return [];
                },
            },
            user: {
                async findMany(args?: Record<string, unknown>) {
                    capturedOrderBy = args?.orderBy;
                    return [];
                },
            },
        }),
    });

    const result = await graphql({
        schema: graphqlSchema,
        source: `
            query {
                users(order_by: [{ name: asc_nulls_last }]) {
                    id
                }
            }
        `,
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual(capturedOrderBy, {
        name: {
            sort: 'asc',
            nulls: 'last',
        },
    });
});

test('wraps an entire mutation operation in one interactive transaction', async () => {
    let transactionCalls = 0;
    const writes: string[] = [];
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        getClient: async () => {
            let activeWrites: string[] = [];
            function transaction<T>(operations: Promise<T>[]): Promise<T[]>;
            function transaction<T>(
                callback: (tx: TransactionTestClient) => Promise<T>
            ): Promise<T>;
            async function transaction<T>(
                input: Promise<T>[] | ((tx: TransactionTestClient) => Promise<T>)
            ): Promise<T[] | T> {
                if (Array.isArray(input)) {
                    return Promise.all(input);
                }

                transactionCalls += 1;
                const previousWrites = activeWrites;
                activeWrites = [];
                try {
                    const result = await input(client);
                    writes.push(...activeWrites);
                    return result;
                } finally {
                    activeWrites = previousWrites;
                }
            }

            let client: TransactionTestClient;
            client = {
                User: {
                    async create(args?: Record<string, unknown>) {
                        activeWrites.push(
                            `create:${(args?.data as { name?: string } | undefined)?.name ?? 'Unknown'}`
                        );
                        return {
                            id: 9,
                            name: (args?.data as { name?: string } | undefined)?.name ?? 'Unknown',
                        };
                    },
                    async update(args?: Record<string, unknown>) {
                        activeWrites.push(
                            `update:${(args?.data as { name?: string } | undefined)?.name ?? 'Unknown'}`
                        );
                        return {
                            id: (args?.where as { id?: number } | undefined)?.id ?? 0,
                            name: (args?.data as { name?: string } | undefined)?.name ?? 'Unknown',
                        };
                    },
                },
                user: {
                    async create(args?: Record<string, unknown>) {
                        activeWrites.push(
                            `create:${(args?.data as { name?: string } | undefined)?.name ?? 'Unknown'}`
                        );
                        return {
                            id: 9,
                            name: (args?.data as { name?: string } | undefined)?.name ?? 'Unknown',
                        };
                    },
                    async update(args?: Record<string, unknown>) {
                        activeWrites.push(
                            `update:${(args?.data as { name?: string } | undefined)?.name ?? 'Unknown'}`
                        );
                        return {
                            id: (args?.where as { id?: number } | undefined)?.id ?? 0,
                            name: (args?.data as { name?: string } | undefined)?.name ?? 'Unknown',
                        };
                    },
                },
                $transaction: transaction,
            };

            return client;
        },
    });

    const result = await graphql({
        schema: graphqlSchema,
        source: `
            mutation {
                insert_users_one(object: { id: 9, name: "Tess", age: 27, role: USER }) {
                    id
                    name
                }
                update_users_by_pk(id: 9, _set: { name: "Tessa" }) {
                    id
                    name
                }
            }
        `,
    });

    assert.equal(result.errors, undefined);
    assert.equal(transactionCalls, 1);
    assert.deepEqual(writes, ['create:Tess', 'update:Tessa']);
    assert.deepEqual(toPlain(result.data), {
        insert_users_one: {
            id: 9,
            name: 'Tess',
        },
        update_users_by_pk: {
            id: 9,
            name: 'Tessa',
        },
    });
});

test('rolls back the transaction when any mutation field errors', async () => {
    let transactionCalls = 0;
    const committedWrites: string[] = [];
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        getClient: async () => {
            let pendingWrites: string[] = [];
            function transaction<T>(operations: Promise<T>[]): Promise<T[]>;
            function transaction<T>(
                callback: (tx: TransactionTestClient) => Promise<T>
            ): Promise<T>;
            async function transaction<T>(
                input: Promise<T>[] | ((tx: TransactionTestClient) => Promise<T>)
            ): Promise<T[] | T> {
                if (Array.isArray(input)) {
                    return Promise.all(input);
                }

                transactionCalls += 1;
                const previousWrites = pendingWrites;
                pendingWrites = [];
                try {
                    const result = await input(client);
                    committedWrites.push(...pendingWrites);
                    return result;
                } finally {
                    pendingWrites = previousWrites;
                }
            }

            let client: TransactionTestClient;
            client = {
                User: {
                    async create(args?: Record<string, unknown>) {
                        pendingWrites.push(
                            `create:${(args?.data as { name?: string } | undefined)?.name ?? 'Unknown'}`
                        );
                        return {
                            id: 10,
                            name: (args?.data as { name?: string } | undefined)?.name ?? 'Unknown',
                        };
                    },
                    async update() {
                        throw new Error('boom');
                    },
                },
                user: {
                    async create(args?: Record<string, unknown>) {
                        pendingWrites.push(
                            `create:${(args?.data as { name?: string } | undefined)?.name ?? 'Unknown'}`
                        );
                        return {
                            id: 10,
                            name: (args?.data as { name?: string } | undefined)?.name ?? 'Unknown',
                        };
                    },
                    async update() {
                        throw new Error('boom');
                    },
                },
                $transaction: transaction,
            };

            return client;
        },
    });

    const result = await graphql({
        schema: graphqlSchema,
        source: `
            mutation {
                insert_users_one(object: { id: 10, name: "Mina", age: 31, role: USER }) {
                    id
                    name
                }
                update_users_by_pk(id: 10, _set: { name: "Broken" }) {
                    id
                    name
                }
            }
        `,
    });

    assert.equal(transactionCalls, 1);
    assert.equal(committedWrites.length, 0);
    assert.equal(result.data, null);
    assert.match(result.errors?.[0]?.message ?? '', /boom/);
});
