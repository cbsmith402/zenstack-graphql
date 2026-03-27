import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ApiHandler } from '@zenstackhq/server/api';

import {
    GraphQLApiHandler,
    createFetchGraphQLHandler,
    printSchema,
} from '../src/index.js';
import { createInMemoryClient, schema } from './helpers.js';

function toPlain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

const apiHandlerCompatibilityCheck: ApiHandler<typeof schema> = new GraphQLApiHandler({ schema });
void apiHandlerCompatibilityCheck;

test('GraphQLApiHandler executes POST and GET requests', async () => {
    const { client } = createInMemoryClient();
    const handler = new GraphQLApiHandler({ schema });

    const post = await handler.handleRequest({
        client,
        method: 'POST',
        path: '/api/graphql',
        requestBody: {
            query: 'query { users(order_by: [{ id: asc }]) { id name } }',
        },
    });

    assert.equal(post.status, 200);
    assert.deepEqual(toPlain(post.body), {
        data: {
            users: [
                { id: 1, name: 'Ada' },
                { id: 2, name: 'Ben' },
            ],
        },
    });

    const get = await handler.handleRequest({
        client,
        method: 'GET',
        path: '/api/graphql',
        query: {
            query: 'query($age: Int!) { users(where: { age: { _gte: $age } }, order_by: [{ id: asc }]) { id } }',
            variables: JSON.stringify({ age: 20 }),
        },
    });

    assert.equal(get.status, 200);
    assert.deepEqual(toPlain(get.body), {
        data: {
            users: [{ id: 1 }],
        },
    });
});

test('GraphQLApiHandler rejects GET mutations and malformed transport payloads', async () => {
    const { client } = createInMemoryClient();
    const handler = new GraphQLApiHandler({ schema });

    const mutation = await handler.handleRequest({
        client,
        method: 'GET',
        path: '/api/graphql',
        query: {
            query: 'mutation { insert_users_one(object: { id: 3, name: "Cara", age: 25, role: USER }) { id } }',
        },
    });

    assert.equal(mutation.status, 405);
    assert.deepEqual(toPlain(mutation.body), {
        errors: [{ message: 'GET requests only support GraphQL queries.' }],
    });

    const malformed = await handler.handleRequest({
        client,
        method: 'POST',
        path: '/api/graphql',
        requestBody: '{',
    });

    assert.equal(malformed.status, 400);
    assert.equal(
        typeof (malformed.body as { errors?: Array<{ message?: string }> }).errors?.[0]?.message,
        'string'
    );
});

test('GraphQLApiHandler can reject unsupported request paths', async () => {
    const { client } = createInMemoryClient();
    const handler = new GraphQLApiHandler({
        schema,
        allowedPaths: [''],
    });

    const response = await handler.handleRequest({
        client,
        method: 'POST',
        path: 'nested/path',
        requestBody: {
            query: 'query { users { id } }',
        },
    });

    assert.equal(response.status, 404);
    assert.deepEqual(toPlain(response.body), {
        errors: [{ message: 'Unsupported GraphQL path "nested/path".' }],
    });
});

test('GraphQLApiHandler supports request-derived context for slicing', async () => {
    const { client } = createInMemoryClient();
    const handler = new GraphQLApiHandler({
        schema,
        getSlicing(request) {
            if (request.context?.role !== 'user') {
                return undefined;
            }
            return {
                models: {
                    user: {
                        excludedFields: ['age'],
                    },
                },
            };
        },
        getCacheKey({ request }: { request: { context?: { role: string } } }) {
            return request.context?.role ?? 'admin';
        },
    });

    const schemaForUser = await handler.getSchema({ role: 'user' });
    const schemaSDL = printSchema(schemaForUser);
    assert.doesNotMatch(schemaSDL, /age: Int/);
});

test('createFetchGraphQLHandler returns a web Response', async () => {
    const { client } = createInMemoryClient();
    const apiHandler = new GraphQLApiHandler({ schema });
    const handler = createFetchGraphQLHandler({
        apiHandler,
        getClient: async () => client,
    });

    const response = await handler(
        new Request('https://example.com/api/graphql?query=query%20%7B%20users(order_by%3A%20%5B%7B%20id%3A%20asc%20%7D%5D)%20%7B%20id%20%7D%20%7D')
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, {
        data: {
            users: [{ id: 1 }, { id: 2 }],
        },
    });
});
