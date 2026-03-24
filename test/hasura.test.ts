import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    HASURA_ROLE_HEADER,
    createHasuraCompatibilityHelpers,
    getHasuraHeaderValue,
} from '../src/index.js';

test('getHasuraHeaderValue resolves from fetch and node-style headers', () => {
    assert.equal(
        getHasuraHeaderValue(new Headers({ [HASURA_ROLE_HEADER]: 'admin' }), HASURA_ROLE_HEADER),
        'admin'
    );
    assert.equal(
        getHasuraHeaderValue({ 'x-hasura-role': 'user' }, HASURA_ROLE_HEADER),
        'user'
    );
    assert.equal(
        getHasuraHeaderValue({ 'X-HASURA-ROLE': 'ADMIN' }, HASURA_ROLE_HEADER),
        'ADMIN'
    );
    assert.equal(
        getHasuraHeaderValue({ 'x-hasura-role': ['user', 'admin'] }, HASURA_ROLE_HEADER),
        'user'
    );
});

test('createHasuraCompatibilityHelpers builds request context and slicing helpers', () => {
    const helpers = createHasuraCompatibilityHelpers({
        defaultRole: 'admin' as const,
        getHeaders(request: { headers: Headers }) {
            return request.headers;
        },
        normalizeRole(role) {
            return role?.toLowerCase() === 'user' ? 'user' : 'admin';
        },
        getSlicing(role) {
            if (role !== 'user') {
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
    });

    const userRequest = {
        headers: new Headers({ [HASURA_ROLE_HEADER]: 'USER' }),
    };
    const userContext = helpers.getContext(userRequest);

    assert.deepEqual(userContext, { role: 'user' });
    assert.deepEqual(helpers.getSlicing(userRequest, userContext), {
        models: {
            user: {
                excludedFields: ['age'],
            },
        },
    });
    assert.equal(helpers.getCacheKey({ context: userContext }), 'user');
    assert.equal(helpers.getContext({ headers: new Headers() }).role, 'admin');
});
