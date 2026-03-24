import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    GraphQLApiHandler,
    createExpressGraphQLMiddleware,
    createFetchGraphQLHandler,
    createHonoGraphQLHandler,
    printSchema,
} from '../src/index.js';
import { createInMemoryClient, schema } from './helpers.js';

function toPlain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

test('GraphQLApiHandler executes POST and GET requests', async () => {
    const { client } = createInMemoryClient();
    const handler = new GraphQLApiHandler({
        schema,
        getClient: async () => client,
    });

    const post = await handler.handle({
        method: 'POST',
        request: { kind: 'post' },
        body: {
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

    const get = await handler.handle({
        method: 'GET',
        request: { kind: 'get' },
        searchParams: new URLSearchParams({
            query: 'query($age: Int!) { users(where: { age: { _gte: $age } }, order_by: [{ id: asc }]) { id } }',
            variables: JSON.stringify({ age: 20 }),
        }),
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
    const handler = new GraphQLApiHandler({
        schema,
        getClient: async () => client,
    });

    const mutation = await handler.handle({
        method: 'GET',
        request: {},
        searchParams: new URLSearchParams({
            query: 'mutation { insert_users_one(object: { id: 3, name: "Cara", age: 25, role: USER }) { id } }',
        }),
    });

    assert.equal(mutation.status, 405);
    assert.deepEqual(toPlain(mutation.body), {
        errors: [{ message: 'GET requests only support GraphQL queries.' }],
    });

    const malformed = await handler.handle({
        method: 'POST',
        request: {},
        body: '{',
    });

    assert.equal(malformed.status, 400);
    assert.equal(
        typeof (malformed.body as { errors?: Array<{ message?: string }> }).errors?.[0]?.message,
        'string'
    );
});

test('GraphQLApiHandler supports request-derived context for slicing', async () => {
    const { client } = createInMemoryClient();
    const handler = new GraphQLApiHandler({
        schema,
        getClient: async () => client,
        getContext(request: Request) {
            return {
                role: request.headers.get('x-hasura-role') ?? 'admin',
            };
        },
        getSlicing(_request: Request, context: { role: string }) {
            if (context.role !== 'user') {
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
        getCacheKey({ context }: { context: { role: string } }) {
            return context.role;
        },
    });

    const schemaForUser = await handler.getSchema(
        new Request('https://example.com/api/graphql', {
            headers: {
                'x-hasura-role': 'user',
            },
        })
    );
    const schemaSDL = printSchema(schemaForUser);
    assert.doesNotMatch(schemaSDL, /age: Int/);
});

test('createFetchGraphQLHandler returns a web Response', async () => {
    const { client } = createInMemoryClient();
    const handler = createFetchGraphQLHandler({
        schema,
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

test('createExpressGraphQLMiddleware writes a JSON response', async () => {
    const { client } = createInMemoryClient();
    const middleware = createExpressGraphQLMiddleware({
        schema,
        getClient: async () => client,
    });

    const req = {
        method: 'POST',
        body: {
            query: 'query { users(order_by: [{ id: asc }]) { id } }',
        },
    };

    let statusCode = 0;
    let jsonBody: unknown;
    const headers = new Map<string, string>();
    const res = {
        status(code: number) {
            statusCode = code;
            return this;
        },
        setHeader(name: string, value: string) {
            headers.set(name, value);
        },
        json(body: unknown) {
            jsonBody = body;
            return body;
        },
    };

    await middleware(req, res);

    assert.equal(statusCode, 200);
    assert.equal(headers.get('content-type'), 'application/json');
    assert.deepEqual(toPlain(jsonBody), {
        data: {
            users: [{ id: 1 }, { id: 2 }],
        },
    });
});

test('createHonoGraphQLHandler delegates to the raw Request', async () => {
    const { client } = createInMemoryClient();
    const handler = createHonoGraphQLHandler({
        schema,
        getClient: async () => client,
    });

    const response = await handler({
        req: {
            raw: new Request('https://example.com/api/graphql', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    query: 'query { users(order_by: [{ id: asc }]) { id name } }',
                }),
            }),
        },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        data: {
            users: [
                { id: 1, name: 'Ada' },
                { id: 2, name: 'Ben' },
            ],
        },
    });
});
