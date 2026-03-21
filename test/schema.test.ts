import assert from 'node:assert/strict';
import test from 'node:test';
import { graphql, printSchema } from 'graphql';

import { createZenStackGraphQLSchema } from '../src/index.js';
import { createInMemoryClient, schema } from './helpers.js';

function toPlain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

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
