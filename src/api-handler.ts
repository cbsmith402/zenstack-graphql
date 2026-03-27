import {
    getOperationAST,
    parse,
    type ExecutionResult,
} from 'graphql';

import {
    createZenStackGraphQLSchemaFactory,
    type CreateZenStackGraphQLSchemaFactoryOptions,
    type ZenStackGraphQLSchemaFactory,
} from './schema-factory.js';
import type {
    GraphQLApiRequestContext,
    GraphQLApiResponse,
    LogConfig,
    SchemaInput,
    SchemaSlicingConfig,
    ZenStackClientLike,
} from './types.js';

export interface CreateGraphQLApiHandlerOptions<
    TClient extends ZenStackClientLike = ZenStackClientLike,
    TContext = undefined,
    TCacheKey = string,
    TSchema extends SchemaInput = SchemaInput,
> extends Omit<
        CreateZenStackGraphQLSchemaFactoryOptions<
            TClient,
            GraphQLApiRequestContext<TClient, TContext>,
            TCacheKey,
            TSchema
        >,
        'getClient' | 'getSlicing' | 'getCacheKey'
    > {
    log?: LogConfig;
    getSlicing?(
        request: GraphQLApiRequestContext<TClient, TContext>
    ): SchemaSlicingConfig | undefined | Promise<SchemaSlicingConfig | undefined>;
    getCacheKey?(input: {
        request: GraphQLApiRequestContext<TClient, TContext>;
        slicing: SchemaSlicingConfig | undefined;
    }): TCacheKey | Promise<TCacheKey>;
    allowedPaths?: string[];
}

type GraphQLOperationInput = {
    query: string;
    variables?: Record<string, unknown>;
    operationName?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function transportError(status: number, message: string): GraphQLApiResponse {
    return {
        status,
        headers: {
            'content-type': 'application/json',
        },
        body: {
            errors: [{ message }],
        },
    };
}

function normalizeRequestPath(path: string): string {
    return path.replace(/^\/+|\/+$/g, '');
}

function getQueryValue(
    query: GraphQLApiRequestContext['query'],
    key: string
): unknown {
    if (!query) {
        return undefined;
    }
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
}

function parseVariables(value: unknown): Record<string, unknown> | undefined {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    if (typeof value === 'string') {
        const parsed = JSON.parse(value) as unknown;
        if (!isPlainObject(parsed)) {
            throw new Error('GraphQL "variables" must be a JSON object.');
        }
        return parsed;
    }
    if (!isPlainObject(value)) {
        throw new Error('GraphQL "variables" must be an object.');
    }
    return value;
}

function parseRequestBody(body: unknown): Record<string, unknown> | undefined {
    if (body === undefined || body === null || body === '') {
        return undefined;
    }
    if (typeof body === 'string') {
        const parsed = JSON.parse(body) as unknown;
        if (!isPlainObject(parsed)) {
            throw new Error('GraphQL request body must be a JSON object.');
        }
        return parsed;
    }
    if (!isPlainObject(body)) {
        throw new Error('GraphQL request body must be an object.');
    }
    return body;
}

function parseOperationInput(request: GraphQLApiRequestContext): GraphQLOperationInput {
    const method = request.method.toUpperCase();
    if (method === 'GET') {
        const query = getQueryValue(request.query, 'query');
        if (typeof query !== 'string' || query.length === 0) {
            throw new Error('A GraphQL "query" string is required.');
        }
        return {
            query,
            variables: parseVariables(getQueryValue(request.query, 'variables')),
            operationName:
                typeof getQueryValue(request.query, 'operationName') === 'string'
                    ? (getQueryValue(request.query, 'operationName') as string)
                    : undefined,
        };
    }

    if (method !== 'POST') {
        throw Object.assign(new Error(`Unsupported GraphQL method "${method}"`), {
            status: 405,
        });
    }

    const body = parseRequestBody(request.requestBody);
    if (!body) {
        throw new Error('A GraphQL "query" string is required.');
    }
    const query = body.query;
    if (typeof query !== 'string' || query.length === 0) {
        throw new Error('A GraphQL "query" string is required.');
    }

    return {
        query,
        variables: parseVariables(body.variables),
        operationName: typeof body.operationName === 'string' ? body.operationName : undefined,
    };
}

function assertGetOperationIsQuery(input: GraphQLOperationInput) {
    const document = parse(input.query);
    const operation = getOperationAST(document, input.operationName);
    if (operation?.operation === 'mutation') {
        throw Object.assign(new Error('GET requests only support GraphQL queries.'), {
            status: 405,
        });
    }
}

function jsonResponse(body: unknown, status = 200): GraphQLApiResponse {
    return {
        status,
        headers: {
            'content-type': 'application/json',
        },
        body,
    };
}

export class GraphQLApiHandler<
    TClient extends ZenStackClientLike = ZenStackClientLike,
    TContext = undefined,
    TCacheKey = string,
    TSchema extends SchemaInput = SchemaInput,
> {
    private readonly schemaFactory: ZenStackGraphQLSchemaFactory<
        GraphQLApiRequestContext<TClient, TContext>,
        TCacheKey
    >;

    private readonly schemaOptions: Omit<
        CreateGraphQLApiHandlerOptions<TClient, TContext, TCacheKey, TSchema>,
        'log' | 'getSlicing' | 'getCacheKey' | 'allowedPaths'
    >;

    constructor(
        private readonly options: CreateGraphQLApiHandlerOptions<
            TClient,
            TContext,
            TCacheKey,
            TSchema
        >
    ) {
        const {
            log: _log,
            getSlicing: _getSlicing,
            getCacheKey: _getCacheKey,
            allowedPaths: _allowedPaths,
            ...schemaOptions
        } = options;
        this.schemaOptions = schemaOptions;
        const resolveSlicing = this.options.getSlicing;
        const resolveCacheKey = this.options.getCacheKey;
        this.schemaFactory = createZenStackGraphQLSchemaFactory<
            TClient,
            GraphQLApiRequestContext<TClient, TContext>,
            TCacheKey,
            TSchema
        >({
            ...this.schemaOptions,
            getClient: async (request) => request.client,
            getSlicing: resolveSlicing
                ? async (request) => resolveSlicing(request)
                : undefined,
            getCacheKey: resolveCacheKey
                ? async (value) =>
                      resolveCacheKey({
                          request: value.context,
                          slicing: value.slicing,
                      })
                : undefined,
        });
    }

    get schema(): TSchema {
        return this.options.schema;
    }

    get log(): LogConfig | undefined {
        return this.options.log;
    }

    async getSchema(context?: TContext) {
        return this.schemaFactory.getSchema({
            client: undefined as unknown as TClient,
            method: 'GET',
            path: '/',
            context,
        });
    }

    async execute(
        request: GraphQLApiRequestContext<TClient, TContext>,
        input: GraphQLOperationInput
    ): Promise<ExecutionResult> {
        return this.schemaFactory.execute({
            contextValue: request,
            source: input.query,
            variableValues: input.variables,
            operationName: input.operationName,
        });
    }

    async handleRequest(
        request: GraphQLApiRequestContext<TClient, TContext>
    ): Promise<GraphQLApiResponse> {
        if (this.options.allowedPaths && this.options.allowedPaths.length > 0) {
            const normalizedRequestPath = normalizeRequestPath(request.path);
            const isAllowed = this.options.allowedPaths.some(
                (path) => normalizeRequestPath(path) === normalizedRequestPath
            );
            if (!isAllowed) {
                return transportError(404, `Unsupported GraphQL path "${request.path}".`);
            }
        }

        let input: GraphQLOperationInput;
        try {
            input = parseOperationInput(request);
            if (request.method.toUpperCase() === 'GET') {
                assertGetOperationIsQuery(input);
            }
        } catch (error) {
            const status =
                isPlainObject(error) && typeof error.status === 'number' ? error.status : 400;
            const message =
                error instanceof Error ? error.message : 'Malformed GraphQL request.';
            return transportError(status, message);
        }

        const result = await this.execute(request, input);
        return jsonResponse(result, 200);
    }
}
