import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { GraphQLError, GraphQLString } from 'graphql';

import {
    createZenStackGraphQLSchema,
    createZenStackGraphQLSchemaFactory,
    graphql,
    printSchema,
} from '../src/index.js';
import type { ModelDefinition, ModelDelegate, ZenStackClientLike } from '../src/index.js';
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
    assert.match(printed, /insert_users\(objects: \[User_insert_input!]!, on_conflict: User_on_conflict\)/);
    assert.match(printed, /insert_users_one\(object: User_insert_input!, on_conflict: User_on_conflict\)/);
    assert.match(printed, /update_users\(where:/);
    assert.match(printed, /delete_users_by_pk\(id: Int!/);
    assert.match(printed, /type User/);
    assert.match(printed, /input User_bool_exp/);
    assert.match(printed, /_nlike: String/);
    assert.match(printed, /_nicontains: String/);
});

test('supports Hasura table-root naming for db-backed model names', async () => {
    const graphqlSchema = createZenStackGraphQLSchema({
        schema: {
            models: {
                IdentityOrganization: {
                    dbName: 'identity_organization',
                    fields: {
                        id: { name: 'id', type: 'Int', id: true },
                        legalName: { name: 'legalName', type: 'String' },
                    },
                    idFields: ['id'],
                    uniqueFields: { id: { type: 'Int' } },
                },
            },
        },
        naming: 'hasura-table',
        getClient: async () => ({
            IdentityOrganization: {
                async findMany() {
                    return [];
                },
                async findUnique() {
                    return null;
                },
                async aggregate() {
                    return { _count: { _all: 0 } };
                },
            },
            identityOrganization: {
                async findMany() {
                    return [];
                },
                async findUnique() {
                    return null;
                },
                async aggregate() {
                    return { _count: { _all: 0 } };
                },
            },
        }),
    });

    const printed = printSchema(graphqlSchema);
    assert.match(printed, /identity_organization\(where:/);
    assert.match(printed, /identity_organization_by_pk\(id: Int!/);
    assert.match(printed, /identity_organization_aggregate\(where:/);
    assert.match(printed, /insert_identity_organization_one\(object: IdentityOrganization_insert_input!/);
    assert.doesNotMatch(printed, /identity_organizations\(/);
});

test('supports Hasura scalar aliases for default and native DB scalar names', async () => {
    const graphqlSchema = createZenStackGraphQLSchema({
        schema: {
            models: {
                IdentityOrganization: {
                    dbName: 'identity_organization',
                    fields: {
                        id: {
                            name: 'id',
                            type: 'String',
                            id: true,
                            attributes: [{ name: '@db.Uuid' }],
                        },
                        slug: {
                            name: 'slug',
                            type: 'String',
                            attributes: [{ name: '@db.Citext' }],
                        },
                        metadata: {
                            name: 'metadata',
                            type: 'Json',
                            optional: true,
                        },
                        balance: {
                            name: 'balance',
                            type: 'Decimal',
                        },
                        externalCount: {
                            name: 'externalCount',
                            type: 'BigInt',
                        },
                        createdAt: {
                            name: 'createdAt',
                            type: 'DateTime',
                        },
                        age: {
                            name: 'age',
                            type: 'Int',
                        },
                    },
                    idFields: ['id'],
                    uniqueFields: {
                        id: { type: 'String' },
                        slug: { type: 'String' },
                    },
                },
            },
        },
        naming: 'hasura-table',
        scalarAliases: 'hasura',
        getClient: async () => ({
            IdentityOrganization: {
                async findMany() {
                    return [];
                },
                async findUnique() {
                    return null;
                },
                async aggregate() {
                    return { _count: { _all: 0 } };
                },
            },
            identityOrganization: {
                async findMany() {
                    return [];
                },
                async findUnique() {
                    return null;
                },
                async aggregate() {
                    return { _count: { _all: 0 } };
                },
            },
        }),
    });

    const printed = printSchema(graphqlSchema);
    assert.match(printed, /scalar uuid/);
    assert.match(printed, /scalar citext/);
    assert.match(printed, /scalar jsonb/);
    assert.match(printed, /scalar numeric/);
    assert.match(printed, /scalar bigint/);
    assert.match(printed, /scalar timestamptz/);
    assert.match(printed, /id: uuid!/);
    assert.match(printed, /slug: citext!/);
    assert.match(printed, /metadata: jsonb/);
    assert.match(printed, /balance: numeric!/);
    assert.match(printed, /externalCount: bigint!/);
    assert.match(printed, /createdAt: timestamptz!/);
    assert.match(printed, /input IdentityOrganization_insert_input[\s\S]*id: uuid/);
    assert.match(printed, /input IdentityOrganization_insert_input[\s\S]*slug: citext/);
    assert.match(printed, /input DateTime_comparison_exp[\s\S]*_eq: timestamptz/);
});

test('supports hasura-compat preset for table roots and generated Hasura type names', async () => {
    const graphqlSchema = createZenStackGraphQLSchema({
        compatibility: 'hasura-compat',
        schema: {
            models: {
                IdentityOrganization: {
                    dbName: 'identity_organization',
                    fields: {
                        id: {
                            name: 'id',
                            type: 'String',
                            id: true,
                            attributes: [{ name: '@db.Uuid' }],
                        },
                        slug: {
                            name: 'slug',
                            type: 'String',
                            attributes: [{ name: '@db.Citext' }],
                        },
                        createdAt: {
                            name: 'createdAt',
                            type: 'DateTime',
                        },
                    },
                    idFields: ['id'],
                    uniqueFields: {
                        id: { type: 'String' },
                        slug: { type: 'String' },
                    },
                },
            },
        },
        getClient: async () => ({
            IdentityOrganization: {
                async findMany() {
                    return [];
                },
                async findUnique() {
                    return null;
                },
                async aggregate() {
                    return { _count: { _all: 0 } };
                },
            },
            identityOrganization: {
                async findMany() {
                    return [];
                },
                async findUnique() {
                    return null;
                },
                async aggregate() {
                    return { _count: { _all: 0 } };
                },
            },
        }),
    });

    const printed = printSchema(graphqlSchema);
    assert.match(printed, /type identity_organization/);
    assert.match(printed, /identity_organization\(where:/);
    assert.match(printed, /input identity_organization_bool_exp/);
    assert.match(printed, /input identity_organization_insert_input/);
    assert.match(printed, /enum identity_organization_constraint/);
    assert.match(printed, /input uuid_comparison_exp[\s\S]*_eq: uuid/);
    assert.match(printed, /input citext_comparison_exp[\s\S]*_eq: citext/);
    assert.match(printed, /input timestamptz_comparison_exp[\s\S]*_eq: timestamptz/);
});

test('validates Hasura-style variable type names under hasura-compat', async () => {
    const graphqlSchema = createZenStackGraphQLSchema({
        compatibility: 'hasura-compat',
        schema: {
            models: {
                IdentityOrganization: {
                    dbName: 'identity_organization',
                    fields: {
                        id: {
                            name: 'id',
                            type: 'String',
                            id: true,
                            attributes: [{ name: '@db.Uuid' }],
                        },
                        slug: {
                            name: 'slug',
                            type: 'String',
                            attributes: [{ name: '@db.Citext' }],
                        },
                        age: {
                            name: 'age',
                            type: 'Int',
                        },
                    },
                    idFields: ['id'],
                    uniqueFields: {
                        id: { type: 'String' },
                        slug: { type: 'String' },
                    },
                },
            },
        },
        getClient: async () => ({
            IdentityOrganization: {
                async findMany(args?: Record<string, unknown>) {
                    assert.deepEqual(args?.where, {
                        AND: [
                            {
                                id: {
                                    equals: 'org_1',
                                },
                                slug: {
                                    equals: 'acme',
                                },
                            },
                        ],
                    });
                    return [{ id: 'org_1', slug: 'acme' }];
                },
                async findUnique() {
                    return null;
                },
                async aggregate() {
                    return { _count: { _all: 0 } };
                },
            },
            identityOrganization: {
                async findMany(args?: Record<string, unknown>) {
                    assert.deepEqual(args?.where, {
                        AND: [
                            {
                                id: {
                                    equals: 'org_1',
                                },
                                slug: {
                                    equals: 'acme',
                                },
                            },
                        ],
                    });
                    return [{ id: 'org_1', slug: 'acme' }];
                },
                async findUnique() {
                    return null;
                },
                async aggregate() {
                    return { _count: { _all: 0 } };
                },
            },
        }),
    });

    const result = await graphql({
        schema: graphqlSchema,
        source: `
            query HasuraCompatTypes(
                $where: identity_organization_bool_exp!
                $id: uuid_comparison_exp!
                $slug: citext_comparison_exp!
            ) {
                identity_organization(where: { _and: [$where, { id: $id, slug: $slug }] }) {
                    id
                    slug
                }
            }
        `,
        variableValues: {
            where: {},
            id: { _eq: 'org_1' },
            slug: { _eq: 'acme' },
        },
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual(toPlain(result.data), {
        identity_organization: [{ id: 'org_1', slug: 'acme' }],
    });
});

test('generates Relay types only when enabled', async () => {
    const { client } = createInMemoryClient();
    const disabledSchema = createZenStackGraphQLSchema({
        schema,
        getClient: async () => client,
    });
    const disabledPrinted = printSchema(disabledSchema);
    assert.doesNotMatch(disabledPrinted, /users_connection/);
    assert.doesNotMatch(disabledPrinted, /type UserNode/);
    assert.doesNotMatch(disabledPrinted, /interface Node/);

    const enabledSchema = createZenStackGraphQLSchema({
        schema,
        relay: { enabled: true },
        getClient: async () => client,
    });
    const enabledPrinted = printSchema(enabledSchema);
    assert.match(enabledPrinted, /users_connection/);
    assert.match(enabledPrinted, /posts_connection/);
    assert.match(enabledPrinted, /type UserNode implements Node/);
    assert.match(enabledPrinted, /type UserConnection/);
    assert.match(enabledPrinted, /interface Node/);
});

test('executes Relay root and nested connections without changing existing list roots', async () => {
    const { client } = createInMemoryClient();
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        relay: { enabled: true },
        getClient: async () => client,
    });

    const result = await graphql({
        schema: graphqlSchema,
        source: `
            query {
                users(order_by: [{ id: asc }]) {
                    id
                    name
                }
                users_connection(first: 1, order_by: [{ id: asc }]) {
                    totalCount
                    nodes {
                        id
                        name
                        age
                        posts_connection(first: 1, order_by: [{ views: desc }]) {
                            totalCount
                            nodes {
                                id
                                title
                                views
                            }
                            pageInfo {
                                hasNextPage
                                hasPreviousPage
                            }
                        }
                    }
                    edges {
                        cursor
                        node {
                            id
                            name
                        }
                    }
                    pageInfo {
                        hasNextPage
                        hasPreviousPage
                        startCursor
                        endCursor
                    }
                }
            }
        `,
    });

    assert.equal(result.errors, undefined);
    const data = toPlain(result.data) as Record<string, any>;
    assert.deepEqual(data.users, [
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Ben' },
    ]);
    assert.equal(data.users_connection.totalCount, 2);
    assert.equal(data.users_connection.nodes[0].name, 'Ada');
    assert.equal(typeof data.users_connection.nodes[0].id, 'string');
    assert.equal(data.users_connection.nodes[0].posts_connection.totalCount, 2);
    assert.equal(data.users_connection.nodes[0].posts_connection.nodes[0].title, 'Hasura Notes');
    assert.equal(data.users_connection.nodes[0].posts_connection.pageInfo.hasNextPage, true);
    assert.equal(data.users_connection.nodes[0].posts_connection.pageInfo.hasPreviousPage, false);
    assert.equal(data.users_connection.pageInfo.hasNextPage, true);
    assert.equal(data.users_connection.pageInfo.hasPreviousPage, false);
    assert.equal(typeof data.users_connection.pageInfo.startCursor, 'string');
    assert.equal(typeof data.users_connection.edges[0].cursor, 'string');
});

test('supports Relay backward pagination and node lookup', async () => {
    const { client } = createInMemoryClient();
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        relay: { enabled: true },
        getClient: async () => client,
    });

    const page = await graphql({
        schema: graphqlSchema,
        source: `
            query {
                users_connection(last: 1, order_by: [{ id: asc }]) {
                    nodes {
                        id
                        name
                    }
                    pageInfo {
                        hasNextPage
                        hasPreviousPage
                    }
                }
            }
        `,
    });

    assert.equal(page.errors, undefined);
    const pageData = toPlain(page.data) as Record<string, any>;
    assert.deepEqual(
        pageData.users_connection.nodes.map((entry: { name: string }) => entry.name),
        ['Ben']
    );
    assert.equal(pageData.users_connection.pageInfo.hasNextPage, false);
    assert.equal(pageData.users_connection.pageInfo.hasPreviousPage, true);

    const nodeId = pageData.users_connection.nodes[0].id;
    const lookup = await graphql({
        schema: graphqlSchema,
        source: `
            query ($id: ID!) {
                node(id: $id) {
                    ... on UserNode {
                        id
                        name
                        age
                    }
                }
            }
        `,
        variableValues: { id: nodeId },
    });

    assert.equal(lookup.errors, undefined);
    assert.deepEqual(toPlain(lookup.data), {
        node: {
            id: nodeId,
            name: 'Ben',
            age: 19,
        },
    });
});

test('rejects invalid Relay cursors and hides pruned models from node lookups', async () => {
    const { client } = createInMemoryClient();
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        relay: { enabled: true },
        slicing: {
            excludedModels: ['Post'],
        },
        getClient: async () => client,
    });

    const badCursor = await graphql({
        schema: graphqlSchema,
        source: `
            query {
                users_connection(first: 1, after: "bad-cursor") {
                    nodes {
                        id
                    }
                }
            }
        `,
    });

    assert.equal(badCursor.data, null);
    assert.equal(badCursor.errors?.[0]?.extensions?.code, 'BAD_USER_INPUT');

    const postNodeId = Buffer.from(
        JSON.stringify({ v: 1, model: 'Post', pk: { id: 10 } }),
        'utf8'
    ).toString('base64url');
    const hidden = await graphql({
        schema: graphqlSchema,
        source: `
            query ($id: ID!) {
                node(id: $id) {
                    id
                }
            }
        `,
        variableValues: { id: postNodeId },
    });

    assert.equal(hidden.errors, undefined);
    assert.deepEqual(toPlain(hidden.data), { node: null });
});

test('supports computed fields from generated zenstack metadata when enabled', async () => {
    let capturedArgs: Record<string, unknown> | undefined;
    const generatedSchemaLike = {
        models: {
            User: {
                fields: {
                    id: {
                        name: 'id',
                        type: 'Int',
                        id: true,
                    },
                    name: {
                        name: 'name',
                        type: 'String',
                    },
                    postCount: {
                        name: 'postCount',
                        type: 'Int',
                        attributes: [{ name: '@computed' }],
                    },
                },
                idFields: ['id'],
                uniqueFields: {
                    id: { type: 'Int' },
                },
            },
        },
    };

    const disabledSchema = createZenStackGraphQLSchema({
        schema: generatedSchemaLike,
        getClient: async () => ({
            User: {
                async findMany() {
                    return [];
                },
            },
            user: {
                async findMany() {
                    return [];
                },
            },
        }),
    });
    const disabledPrinted = printSchema(disabledSchema);
    assert.doesNotMatch(disabledPrinted, /postCount: Int!/);
    assert.doesNotMatch(disabledPrinted, /postCount/);

    const enabledSchema = createZenStackGraphQLSchema({
        schema: generatedSchemaLike,
        features: {
            computedFields: true,
        },
        getClient: async () => ({
            User: {
                async findMany(args?: Record<string, unknown>) {
                    capturedArgs = args;
                    return [{ id: 1, name: 'Ada', postCount: 2 }];
                },
            },
            user: {
                async findMany(args?: Record<string, unknown>) {
                    capturedArgs = args;
                    return [{ id: 1, name: 'Ada', postCount: 2 }];
                },
            },
        }),
    });

    const enabledPrinted = printSchema(enabledSchema);
    assert.match(enabledPrinted, /postCount: Int!/);
    assert.match(enabledPrinted, /input User_bool_exp[\s\S]*postCount: Int_comparison_exp/);
    assert.match(enabledPrinted, /input User_order_by[\s\S]*postCount: order_by/);
    assert.doesNotMatch(enabledPrinted, /input User_insert_input[\s\S]*postCount:/);
    assert.doesNotMatch(enabledPrinted, /input User_set_input[\s\S]*postCount:/);

    const result = await graphql({
        schema: enabledSchema,
        source: `
            query {
                users(
                    where: { postCount: { _gt: 1 } }
                    order_by: [{ postCount: desc }]
                ) {
                    id
                    name
                    postCount
                }
            }
        `,
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual(toPlain(result.data), {
        users: [{ id: 1, name: 'Ada', postCount: 2 }],
    });
    assert.deepEqual(capturedArgs, {
        where: {
            postCount: {
                gt: 1,
            },
        },
        orderBy: {
            postCount: 'desc',
        },
        distinct: undefined,
        take: undefined,
        skip: undefined,
        select: {
            id: true,
            name: true,
            postCount: true,
        },
    });
});

test('generates procedure roots from zenstack schema metadata', async () => {
    const graphqlSchema = createZenStackGraphQLSchema({
        schema: {
            provider: { type: 'sqlite' },
            models: {
                User: {
                    fields: {
                        id: { name: 'id', type: 'Int', id: true },
                        name: { name: 'name', type: 'String' },
                    },
                    idFields: ['id'],
                    uniqueFields: { id: { type: 'Int' } },
                },
            },
            typeDefs: {
                FeedSummary: {
                    fields: {
                        totalUsers: { name: 'totalUsers', type: 'Int' },
                        featuredUser: { name: 'featuredUser', type: 'User', optional: true },
                    },
                },
            },
            procedures: {
                getFeedSummary: {
                    params: {
                        minId: { name: 'minId', type: 'Int', optional: true },
                    },
                    returnType: 'FeedSummary',
                },
                signUp: {
                    mutation: true,
                    params: {
                        name: { name: 'name', type: 'String' },
                    },
                    returnType: 'User',
                },
            },
        },
        getClient: async () => ({
            $procs: {
                async getFeedSummary(input?: { args?: Record<string, unknown> }) {
                    assert.deepEqual(input, { args: { minId: 2 } });
                    return {
                        totalUsers: 1,
                        featuredUser: { id: 2, name: 'Ben' },
                    };
                },
                async signUp(input?: { args?: Record<string, unknown> }) {
                    assert.deepEqual(input, { args: { name: 'Cara' } });
                    return { id: 3, name: 'Cara' };
                },
            },
        }),
    });

    const printed = printSchema(graphqlSchema);
    assert.match(printed, /getFeedSummary\(minId: Int\): FeedSummary/);
    assert.match(printed, /signUp\(name: String!\): User/);
    assert.match(printed, /type FeedSummary/);

    const queryResult = await graphql({
        schema: graphqlSchema,
        source: `
            query {
                getFeedSummary(minId: 2) {
                    totalUsers
                    featuredUser {
                        id
                        name
                    }
                }
            }
        `,
    });

    assert.equal(queryResult.errors, undefined);
    assert.deepEqual(toPlain(queryResult.data), {
        getFeedSummary: {
            totalUsers: 1,
            featuredUser: { id: 2, name: 'Ben' },
        },
    });

    const mutationResult = await graphql({
        schema: graphqlSchema,
        source: `
            mutation {
                signUp(name: "Cara") {
                    id
                    name
                }
            }
        `,
    });

    assert.equal(mutationResult.errors, undefined);
    assert.deepEqual(toPlain(mutationResult.data), {
        signUp: {
            id: 3,
            name: 'Cara',
        },
    });
});

test('allows manual root field extensions for custom resolvers', async () => {
    const customClient = { marker: 'demo' } as ZenStackClientLike & { marker: string };
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        getClient: async () => customClient,
        extensions: {
            query: {
                ping: {
                    type: GraphQLString,
                    resolve: (_source, _args, _context, _info, { client }) =>
                        `${client.marker}:pong`,
                },
            },
            mutation: {
                echo: {
                    type: GraphQLString,
                    args: {
                        value: { type: GraphQLString },
                    },
                    resolve: (_source, args, _context, _info, { client }) =>
                        `${client.marker}:${String(args.value ?? '')}`,
                },
            },
        },
    });

    const printed = printSchema(graphqlSchema);
    assert.match(printed, /ping: String/);
    assert.match(printed, /echo\(value: String\): String/);

    const queryResult = await graphql({
        schema: graphqlSchema,
        source: '{ ping }',
    });
    assert.equal(queryResult.errors, undefined);
    assert.deepEqual(toPlain(queryResult.data), {
        ping: 'demo:pong',
    });

    const mutationResult = await graphql({
        schema: graphqlSchema,
        source: 'mutation { echo(value: "hi") }',
    });
    assert.equal(mutationResult.errors, undefined);
    assert.deepEqual(toPlain(mutationResult.data), {
        echo: 'demo:hi',
    });
});

test('prunes models, fields, operations, and procedures with slicing config', async () => {
    const graphqlSchema = createZenStackGraphQLSchema({
        schema: {
            ...schema,
            procedures: {
                getUserSummary: {
                    returnType: 'User',
                },
                getPostSummary: {
                    returnType: 'Post',
                },
            },
        },
        slicing: {
            excludedModels: ['Post'],
            excludedProcedures: ['getPostSummary'],
            models: {
                user: {
                    excludedOperations: ['deleteMany', 'deleteByPk', 'insertMany'],
                    excludedFields: ['age'],
                },
            },
        },
        getClient: async () => ({
            User: {
                async findMany() {
                    return [];
                },
            },
            user: {
                async findMany() {
                    return [];
                },
            },
            $procs: {
                async getUserSummary() {
                    return { id: 1, name: 'Ada', role: 'ADMIN' };
                },
                async getPostSummary() {
                    return { id: 10, title: 'Hidden' };
                },
            },
        }),
    });

    const printed = printSchema(graphqlSchema);
    assert.match(printed, /users\(where:/);
    assert.match(printed, /insert_users_one\(object: User_insert_input!/);
    assert.match(printed, /getUserSummary: User/);
    assert.doesNotMatch(printed, /type Post\b/);
    assert.doesNotMatch(printed, /posts\(where:/);
    assert.doesNotMatch(printed, /posts_aggregate/);
    assert.doesNotMatch(printed, /insert_users\(objects:/);
    assert.doesNotMatch(printed, /delete_users\(where:/);
    assert.doesNotMatch(printed, /delete_users_by_pk\(id: Int!/);
    assert.doesNotMatch(printed, /age: Int!/);
    assert.doesNotMatch(printed, /posts: \[Post!/);
    assert.doesNotMatch(printed, /getPostSummary/);
});

test('prunes field-level filter operators with slicing config', async () => {
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        slicing: {
            models: {
                post: {
                    fields: {
                        title: {
                            includedFilterKinds: ['Equality'],
                        },
                    },
                },
            },
        },
        getClient: async () => ({
            User: {
                async findMany() {
                    return [];
                },
            },
            user: {
                async findMany() {
                    return [];
                },
            },
            Post: {
                async findMany() {
                    return [];
                },
            },
            post: {
                async findMany() {
                    return [];
                },
            },
        }),
    });

    const printed = printSchema(graphqlSchema);
    assert.match(printed, /input Post_title_comparison_exp/);
    assert.match(printed, /title: Post_title_comparison_exp/);
    assert.doesNotMatch(printed, /input Post_title_comparison_exp\s*\{[^}]*_contains: String/);
    assert.doesNotMatch(printed, /input Post_title_comparison_exp\s*\{[^}]*_like: String/);
    assert.match(printed, /input Post_title_comparison_exp\s*\{[^}]*_eq:/);
});

test('prunes nested relation mutation inputs when related operations are sliced out', async () => {
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        slicing: {
            models: {
                post: {
                    includedOperations: ['queryMany'],
                },
            },
        },
        getClient: async () => ({
            User: {
                async findMany() {
                    return [];
                },
            },
            user: {
                async findMany() {
                    return [];
                },
            },
            Post: {
                async findMany() {
                    return [];
                },
            },
            post: {
                async findMany() {
                    return [];
                },
            },
        }),
    });

    const printed = printSchema(graphqlSchema);
    assert.doesNotMatch(printed, /input User_insert_input[\s\S]*posts:/);
    assert.doesNotMatch(printed, /input User_set_input[\s\S]*posts:/);
    assert.doesNotMatch(printed, /insert_posts_one/);
    assert.doesNotMatch(printed, /update_posts_by_pk/);
});

test('creates and caches pruned schemas per role with the schema factory', async () => {
    const { client } = createInMemoryClient();
    const factory = createZenStackGraphQLSchemaFactory({
        schema,
        getClient: async () => client,
        getSlicing(context: { role: 'admin' | 'user' }) {
            if (context.role === 'admin') {
                return undefined;
            }

            return {
                models: {
                    user: {
                        excludedFields: ['age'],
                        excludedOperations: ['deleteMany', 'deleteByPk'],
                    },
                },
            };
        },
        getCacheKey({ context }) {
            return context.role;
        },
    });

    const adminSchema = await factory.getSchema({ role: 'admin' });
    const adminSchemaAgain = await factory.getSchema({ role: 'admin' });
    const userSchema = await factory.getSchema({ role: 'user' });

    assert.equal(adminSchema, adminSchemaAgain);
    assert.notEqual(adminSchema, userSchema);

    const adminPrinted = printSchema(adminSchema);
    const userPrinted = printSchema(userSchema);

    assert.match(adminPrinted, /age: Int!/);
    assert.match(adminPrinted, /delete_users_by_pk\(id: Int!/);
    assert.doesNotMatch(userPrinted, /age: Int!/);
    assert.doesNotMatch(userPrinted, /delete_users_by_pk\(id: Int!/);
});

test('executes requests against the role-specific pruned schema factory', async () => {
    const { client } = createInMemoryClient();
    const factory = createZenStackGraphQLSchemaFactory({
        schema,
        getClient: async () => client,
        getSlicing(context: { role: 'admin' | 'user' }) {
            return context.role === 'user'
                ? {
                      models: {
                          user: {
                              excludedFields: ['age'],
                          },
                      },
                  }
                : undefined;
        },
        getCacheKey({ context }) {
            return context.role;
        },
    });

    const userResult = await factory.execute({
        contextValue: { role: 'user' },
        source: `
            query {
                users(order_by: [{ id: asc }]) {
                    id
                    name
                }
            }
        `,
    });

    assert.equal(userResult.errors, undefined);
    assert.deepEqual(toPlain(userResult.data), {
        users: [
            { id: 1, name: 'Ada' },
            { id: 2, name: 'Ben' },
        ],
    });

    const userAgeResult = await factory.execute({
        contextValue: { role: 'user' },
        source: `
            query {
                users {
                    id
                    age
                }
            }
        `,
    });

    assert.ok(userAgeResult.errors);
    assert.match(
        userAgeResult.errors[0]?.message ?? '',
        /Cannot query field "age" on type "User"/
    );

    const adminAgeResult = await factory.execute({
        contextValue: { role: 'admin' },
        source: `
            query {
                users(order_by: [{ id: asc }]) {
                    id
                    age
                }
            }
        `,
    });

    assert.equal(adminAgeResult.errors, undefined);
    assert.deepEqual(toPlain(adminAgeResult.data), {
        users: [
            { id: 1, age: 34 },
            { id: 2, age: 19 },
        ],
    });
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

test('supports Hasura aggregate count predicates through ORM-backed relation filters', async () => {
    const { client } = createInMemoryClient({
        users: [
            { id: 1, name: 'Ada', age: 34, role: 'ADMIN' },
            { id: 2, name: 'Ben', age: 19, role: 'USER' },
            { id: 3, name: 'Cara', age: 27, role: 'USER' },
        ],
    });
    const graphqlSchema = createZenStackGraphQLSchema({
        compatibility: 'hasura-compat',
        schema,
        getClient: async () => client,
    });

    const result = await graphql({
        schema: graphqlSchema,
        source: `
            query {
                empty: user(
                    where: { posts_aggregate: { count: { predicate: { _eq: 0 } } } }
                    order_by: [{ id: asc }]
                ) {
                    id
                    name
                }
                active: user(
                    where: {
                        posts_aggregate: {
                            count: {
                                predicate: { _gt: 0 }
                                filter: { views: { _gte: 8 } }
                            }
                        }
                    }
                    order_by: [{ id: asc }]
                ) {
                    id
                    name
                }
            }
        `,
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual(toPlain(result.data), {
        empty: [{ id: 3, name: 'Cara' }],
        active: [
            { id: 1, name: 'Ada' },
            { id: 2, name: 'Ben' },
        ],
    });
});

test('rejects unsupported Hasura aggregate count predicates with BAD_USER_INPUT', async () => {
    const { client } = createInMemoryClient();
    const graphqlSchema = createZenStackGraphQLSchema({
        compatibility: 'hasura-compat',
        schema,
        getClient: async () => client,
    });

    const result = await graphql({
        schema: graphqlSchema,
        source: `
            query {
                user(where: { posts_aggregate: { count: { predicate: { _eq: 2 } } } }) {
                    id
                }
            }
        `,
    });

    assert.ok(result.errors);
    assert.equal(result.errors[0]?.extensions?.code, 'BAD_USER_INPUT');
});

test('supports extended string negation operators', async () => {
    const { client } = createInMemoryClient();
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        getClient: async () => client,
    });

    const result = await graphql({
        schema: graphqlSchema,
        source: `
            query {
                users(where: { name: { _nicontains: "EN" } }, order_by: [{ id: asc }]) {
                    id
                    name
                }
                posts(where: { title: { _nlike: "%Notes%" } }, order_by: [{ id: asc }]) {
                    id
                    title
                }
            }
        `,
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual(toPlain(result.data), {
        users: [{ id: 1, name: 'Ada' }],
        posts: [
            { id: 10, title: 'ZenStack Intro' },
            { id: 12, title: 'GraphQL Adapter' },
        ],
    });
});

test('exposes provider-specific json and scalar-list operators for postgresql', async () => {
    const graphqlSchema = createZenStackGraphQLSchema({
        schema: {
            provider: { type: 'postgresql' },
            models: [
                {
                    name: 'Document',
                    fields: [
                        { name: 'id', kind: 'scalar', type: 'Int', isId: true },
                        { name: 'metadata', kind: 'scalar', type: 'Json', isNullable: true },
                        { name: 'tags', kind: 'scalar', type: 'String', isList: true },
                    ],
                },
            ],
        },
        getClient: async () => ({
            Document: {
                async findMany() {
                    return [];
                },
            },
            document: {
                async findMany() {
                    return [];
                },
            },
        }),
    });

    const printed = printSchema(graphqlSchema);
    assert.match(printed, /input Json_comparison_exp/);
    assert.match(printed, /path: String/);
    assert.match(printed, /string_contains: String/);
    assert.match(printed, /mode: query_mode/);
    assert.match(printed, /input String_list_comparison_exp/);
    assert.match(printed, /hasSome: \[String!]/);
});

test('compiles provider-specific json and scalar-list filters', async () => {
    let capturedWhere: unknown;
    const graphqlSchema = createZenStackGraphQLSchema({
        schema: {
            provider: { type: 'postgresql' },
            models: [
                {
                    name: 'Document',
                    fields: [
                        { name: 'id', kind: 'scalar', type: 'Int', isId: true },
                        { name: 'metadata', kind: 'scalar', type: 'Json', isNullable: true },
                        { name: 'tags', kind: 'scalar', type: 'String', isList: true },
                    ],
                },
            ],
        },
        getClient: async () => ({
            Document: {
                async findMany(args?: Record<string, unknown>) {
                    capturedWhere = args?.where;
                    return [];
                },
            },
            document: {
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
                documents(
                    where: {
                        metadata: {
                            path: "$.bio"
                            string_contains: "dev"
                            mode: insensitive
                        }
                        tags: { hasSome: ["graphql", "zenstack"] }
                    }
                ) {
                    id
                }
            }
        `,
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual(capturedWhere, {
        metadata: {
            path: '$.bio',
            string_contains: 'dev',
            mode: 'insensitive',
        },
        tags: {
            hasSome: ['graphql', 'zenstack'],
        },
    });
});

test('supports _between filters for comparable scalar fields', async () => {
    const { client } = createInMemoryClient();
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        getClient: async () => client,
    });

    const printed = printSchema(graphqlSchema);
    assert.match(printed, /_between: \[Int!]/);

    const result = await graphql({
        schema: graphqlSchema,
        source: `
            query {
                users(where: { age: { _between: [20, 40] } }, order_by: [{ id: asc }]) {
                    id
                    name
                    age
                }
            }
        `,
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual(toPlain(result.data), {
        users: [{ id: 1, name: 'Ada', age: 34 }],
    });
});

test('generates and compiles typed json filters from type definitions', async () => {
    let capturedWhere: unknown;
    const graphqlSchema = createZenStackGraphQLSchema({
        schema: {
            provider: { type: 'postgresql' },
            typeDefs: {
                Job: {
                    fields: {
                        title: { name: 'title', type: 'String' },
                    },
                },
                Profile: {
                    fields: {
                        age: { name: 'age', type: 'Int', optional: true },
                        jobs: { name: 'jobs', type: 'Job', array: true, optional: true },
                    },
                },
            },
            models: {
                User: {
                    fields: {
                        id: { name: 'id', type: 'Int', id: true },
                        name: { name: 'name', type: 'String' },
                        profile: { name: 'profile', type: 'Profile', optional: true },
                    },
                    idFields: ['id'],
                    uniqueFields: { id: { type: 'Int' } },
                },
            },
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

    const printed = printSchema(graphqlSchema);
    assert.match(printed, /profile: Profile_bool_exp/);
    assert.match(printed, /jobs: Job_list_bool_exp/);

    const result = await graphql({
        schema: graphqlSchema,
        source: `
            query {
                users(
                    where: {
                        profile: {
                            age: { _between: [18, 65] }
                            jobs: {
                                some: {
                                    title: { _contains: "Dev" }
                                }
                            }
                        }
                    }
                ) {
                    id
                }
            }
        `,
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual(capturedWhere, {
        profile: {
            age: {
                between: [18, 65],
            },
            jobs: {
                some: {
                    title: {
                        contains: 'Dev',
                    },
                },
            },
        },
    });
});

test('gates provider-specific json mode and scalar-list operators for sqlite', async () => {
    const graphqlSchema = createZenStackGraphQLSchema({
        schema: {
            provider: { type: 'sqlite' },
            models: [
                {
                    name: 'Document',
                    fields: [
                        { name: 'id', kind: 'scalar', type: 'Int', isId: true },
                        { name: 'metadata', kind: 'scalar', type: 'Json', isNullable: true },
                        { name: 'tags', kind: 'scalar', type: 'String', isList: true },
                    ],
                },
            ],
        },
        getClient: async () => ({
            Document: {
                async findMany() {
                    return [];
                },
            },
            document: {
                async findMany() {
                    return [];
                },
            },
        }),
    });

    const printed = printSchema(graphqlSchema);
    assert.doesNotMatch(printed, /mode: query_mode/);
    assert.doesNotMatch(printed, /hasSome: \[String!]/);
    assert.doesNotMatch(printed, /distinct_on:/);
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

test('supports insert_many on_conflict upserts', async () => {
    const { client, store } = createInMemoryClient();
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        getClient: async () => client,
    });

    const result = await graphql({
        schema: graphqlSchema,
        source: `
            mutation {
                insert_users(
                    objects: [
                        { id: 2, name: "Benny", age: 21, role: USER }
                        { id: 3, name: "Cara", age: 25, role: USER }
                    ]
                    on_conflict: {
                        constraint: User_pkey
                        update_columns: [name, age]
                    }
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
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual(toPlain(result.data), {
        insert_users: {
            affected_rows: 2,
            returning: [
                { id: 2, name: 'Benny', age: 21, role: 'USER' },
                { id: 3, name: 'Cara', age: 25, role: 'USER' },
            ],
        },
    });
    assert.equal(store.users.find((user) => user.id === 2)?.name, 'Benny');
    assert.equal(store.users.find((user) => user.id === 3)?.name, 'Cara');
});

test('supports relationship-aware updates through mutation roots', async () => {
    const { client, store } = createInMemoryClient();
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        getClient: async () => client,
    });

    const result = await graphql({
        schema: graphqlSchema,
        source: `
            mutation {
                update_users_by_pk(
                    id: 2
                    _set: {
                        posts: {
                            create: [{ title: "Nested Create On Update", views: 4 }]
                        }
                    }
                ) {
                    id
                    name
                    posts(order_by: [{ id: asc }]) {
                        id
                        title
                        views
                    }
                }
                update_posts(
                    where: { id: { _eq: 12 } }
                    _set: {
                        author: {
                            update: {
                                _set: { name: "Ben Updated Through Post" }
                            }
                        }
                    }
                ) {
                    affected_rows
                    returning {
                        id
                        author {
                            id
                            name
                        }
                    }
                }
                patch_user_posts: update_users(
                    where: { id: { _eq: 1 } }
                    _set: {
                        posts: {
                            update_many: [
                                {
                                    where: { id: { _eq: 10 } }
                                    _set: { title: "ZenStack Advanced" }
                                    _inc: { views: 10 }
                                }
                            ]
                        }
                    }
                ) {
                    affected_rows
                    returning {
                        id
                        posts(order_by: [{ id: asc }]) {
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
        update_users_by_pk: {
            id: 2,
            name: 'Ben',
            posts: [
                { id: 12, title: 'GraphQL Adapter', views: 13 },
                { id: 13, title: 'Nested Create On Update', views: 4 },
            ],
        },
        update_posts: {
            affected_rows: 1,
            returning: [{ id: 12, author: { id: 2, name: 'Ben Updated Through Post' } }],
        },
        patch_user_posts: {
            affected_rows: 1,
            returning: [
                {
                    id: 1,
                    posts: [
                        { id: 10, title: 'ZenStack Advanced', views: 15 },
                        { id: 11, title: 'Hasura Notes', views: 8 },
                    ],
                },
            ],
        },
    });
    assert.equal(store.users.find((user) => user.id === 2)?.name, 'Ben Updated Through Post');
    assert.equal(store.posts.find((post) => post.id === 10)?.title, 'ZenStack Advanced');
});

test('only exposes by_pk roots for real primary keys', async () => {
    const uniqueOnlySchema: { models: ModelDefinition[] } = {
        models: [
            {
                name: 'EmailUser',
                fields: [
                    { name: 'email', kind: 'scalar', type: 'String', isUnique: true },
                    { name: 'name', kind: 'scalar', type: 'String' },
                ],
            },
        ],
    };

    const graphqlSchema = createZenStackGraphQLSchema({
        schema: uniqueOnlySchema,
        getClient: async () => ({
            EmailUser: {
                async findMany() {
                    return [];
                },
            },
            emailUser: {
                async findMany() {
                    return [];
                },
            },
        }),
    });

    const printed = printSchema(graphqlSchema);
    assert.doesNotMatch(printed, /emailUsers_by_pk/);
    assert.doesNotMatch(printed, /update_emailUsers_by_pk/);
    assert.doesNotMatch(printed, /delete_emailUsers_by_pk/);
    assert.match(printed, /insert_emailUsers_one\(object: EmailUser_insert_input!, on_conflict: EmailUser_on_conflict\)/);
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

test('normalizes hook failures and preserves nested error details', async () => {
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        getClient: async () => createInMemoryClient().client,
        hooks: {
            beforeResolve() {
                throw Object.assign(new Error('outer failure'), {
                    cause: Object.assign(new Error('invalid filter payload'), {
                        name: 'ZenStackValidationError',
                        code: 'SQLITE_VALIDATION',
                        details: { field: 'where.age' },
                    }),
                });
            },
            async formatError(error) {
                return new GraphQLError(error.message, {
                    extensions: {
                        ...error.extensions,
                        formattedByHook: true,
                    },
                });
            },
        },
    });

    const result = await graphql({
        schema: graphqlSchema,
        source: '{ users { id } }',
    });

    assert.equal(result.data, null);
    assert.equal(result.errors?.[0]?.extensions?.code, 'BAD_USER_INPUT');
    assert.equal(result.errors?.[0]?.extensions?.originalCode, 'SQLITE_VALIDATION');
    assert.deepEqual(result.errors?.[0]?.extensions?.details, { field: 'where.age' });
    assert.equal(result.errors?.[0]?.extensions?.formattedByHook, true);
});

test('normalizes manual extension resolver failures with the shared resolver path', async () => {
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        getClient: async () => createInMemoryClient().client,
        extensions: {
            query: {
                explode: {
                    type: GraphQLString,
                    resolve() {
                        throw Object.assign(new Error('not allowed'), {
                            name: 'UnauthorizedError',
                        });
                    },
                },
            },
        },
    });

    const result = await graphql({
        schema: graphqlSchema,
        source: '{ explode }',
    });

    assert.deepEqual(toPlain(result.data), { explode: null });
    assert.equal(result.errors?.[0]?.extensions?.code, 'FORBIDDEN');
});

test('omits insensitive mode for sqlite-backed string filters', async () => {
    let capturedWhere: unknown;
    const graphqlSchema = createZenStackGraphQLSchema({
        schema: {
            ...schema,
            provider: { type: 'sqlite' },
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

test('preserves negated insensitive filters for providers that support mode', async () => {
    let capturedWhere: unknown;
    const graphqlSchema = createZenStackGraphQLSchema({
        schema: {
            ...schema,
            provider: { type: 'postgresql' },
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
                users(where: { name: { _nilike: "%Ada%" } }) {
                    id
                }
            }
        `,
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual(capturedWhere, {
        name: {
            not: {
                contains: 'Ada',
                mode: 'insensitive',
            },
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

test('preserves the client binding when invoking $transaction', async () => {
    let transactionCalls = 0;
    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        getClient: async () => {
            const txClient = {
                User: {
                    async create() {
                        return { id: 7, name: 'Bound Tess' };
                    },
                },
                user: {
                    async create() {
                        return { id: 7, name: 'Bound Tess' };
                    },
                },
            } as TransactionTestClient;

            const client = {
                interactiveTransaction: async <T,>(
                    callback: (tx: TransactionTestClient) => Promise<T>
                ) => callback(txClient),
                $transaction<T>(input: Promise<T>[] | ((tx: TransactionTestClient) => Promise<T>)) {
                    if (Array.isArray(input)) {
                        return Promise.all(input);
                    }
                    transactionCalls += 1;
                    return this.interactiveTransaction(input);
                },
            } as TransactionTestClient & {
                interactiveTransaction: <T>(
                    callback: (tx: TransactionTestClient) => Promise<T>
                ) => Promise<T>;
            };

            return client;
        },
    });

    const result = await graphql({
        schema: graphqlSchema,
        source: `
            mutation {
                insert_users_one(object: { id: 7, name: "Bound Tess", age: 27, role: USER }) {
                    id
                    name
                }
            }
        `,
    });

    assert.equal(result.errors, undefined);
    assert.equal(transactionCalls, 1);
    assert.deepEqual(toPlain(result.data), {
        insert_users_one: {
            id: 7,
            name: 'Bound Tess',
        },
    });
});

test('provides transaction-scoped clients to custom extension mutation resolvers', async () => {
    type ExtensionClient = ZenStackClientLike & { marker: string };

    const graphqlSchema = createZenStackGraphQLSchema({
        schema,
        getClient: async () => {
            const txClient = {
                marker: 'tx',
            } as ExtensionClient;

            const client = {
                marker: 'base',
                $transaction: async <T,>(
                    input: Promise<T>[] | ((tx: ExtensionClient) => Promise<T>)
                ) => {
                    if (Array.isArray(input)) {
                        return Promise.all(input);
                    }
                    return input(txClient);
                },
            } as ExtensionClient;

            return client;
        },
        extensions: {
            mutation: {
                whoAmI: {
                    type: GraphQLString,
                    resolve: (_source, _args, _context, _info, { client }) => client.marker,
                },
            },
        },
    });

    const result = await graphql({
        schema: graphqlSchema,
        source: 'mutation { whoAmI }',
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual(toPlain(result.data), {
        whoAmI: 'tx',
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
