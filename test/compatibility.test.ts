import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { createZenStackGraphQLSchema, graphql } from '../src/index.js';
import { createInMemoryClient, schema } from './helpers.js';

function toPlain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

type CompatibilityFixture = {
    name: string;
    source: string;
    expectedData: Record<string, unknown>;
};

const fixtures: CompatibilityFixture[] = [
    {
        name: 'nested reads with where, order_by, limit, and aggregate roots',
        source: `
            query HasuraNestedReads {
                users(order_by: [{ age: desc }], limit: 1) {
                    id
                    name
                    age
                    posts(where: { views: { _gte: 5 } }, order_by: [{ id: asc }]) {
                        id
                        title
                        views
                    }
                }

                users_aggregate(where: { role: { _eq: ADMIN } }) {
                    aggregate {
                        count
                        avg {
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
        expectedData: {
            users: [
                {
                    id: 1,
                    name: 'Ada',
                    age: 34,
                    posts: [
                        { id: 10, title: 'ZenStack Intro', views: 5 },
                        { id: 11, title: 'Hasura Notes', views: 8 },
                    ],
                },
            ],
            users_aggregate: {
                aggregate: {
                    count: 1,
                    avg: { age: 34 },
                },
                nodes: [{ id: 1, name: 'Ada' }],
            },
        },
    },
    {
        name: 'distinct_on, by_pk, and relation aggregate fields',
        source: `
            query HasuraDistinctAndAggregate {
                posts(distinct_on: [authorId], order_by: [{ authorId: asc }, { views: desc }]) {
                    id
                    title
                    authorId
                }

                users_by_pk(id: 1) {
                    id
                    posts_aggregate(order_by: [{ views: desc }]) {
                        aggregate {
                            count
                            sum {
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
        expectedData: {
            posts: [
                { id: 11, title: 'Hasura Notes', authorId: 1 },
                { id: 12, title: 'GraphQL Adapter', authorId: 2 },
            ],
            users_by_pk: {
                id: 1,
                posts_aggregate: {
                    aggregate: {
                        count: 2,
                        sum: { views: 13 },
                    },
                    nodes: [
                        { id: 11, title: 'Hasura Notes', views: 8 },
                        { id: 10, title: 'ZenStack Intro', views: 5 },
                    ],
                },
            },
        },
    },
    {
        name: 'insert_many mutation responses with returning payloads',
        source: `
            mutation HasuraInsertReturning {
                insert_users(
                    objects: [
                        { name: "Cara", age: 25, role: USER }
                        { name: "Drew", age: 28, role: USER }
                    ]
                ) {
                    affected_rows
                    returning {
                        id
                        name
                        age
                        role
                    }
                }
            }
        `,
        expectedData: {
            insert_users: {
                affected_rows: 2,
                returning: [
                    { id: 3, name: 'Cara', age: 25, role: 'USER' },
                    { id: 4, name: 'Drew', age: 28, role: 'USER' },
                ],
            },
        },
    },
    {
        name: 'insert_one on_conflict upsert behavior',
        source: `
            mutation HasuraUpsert {
                insert_users_one(
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
        expectedData: {
            insert_users_one: {
                id: 2,
                name: 'Benny',
                age: 21,
                role: 'USER',
            },
        },
    },
];

for (const fixture of fixtures) {
    test(`matches Hasura-style compatibility fixture: ${fixture.name}`, async () => {
        const { client } = createInMemoryClient();
        const graphqlSchema = createZenStackGraphQLSchema({
            schema,
            getClient: async () => client,
        });

        const result = await graphql({
            schema: graphqlSchema,
            source: fixture.source,
        });

        assert.equal(result.errors, undefined);
        assert.deepEqual(toPlain(result.data), fixture.expectedData);
    });
}

test.todo('matches Hasura-style relation aggregate order_by semantics on parent collections');
test.todo('matches richer Hasura relationship filter semantics beyond simple list->some lowering');
