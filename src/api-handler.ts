import {
    getOperationAST,
    parse,
    type ExecutionResult,
    type GraphQLArgs,
    type GraphQLSchema,
} from 'graphql';

import {
    createZenStackGraphQLSchemaFactory,
    type CreateZenStackGraphQLSchemaFactoryOptions,
    type ZenStackGraphQLSchemaFactory,
} from './schema-factory.js';
import { graphql } from './execution.js';
import type {
    GraphQLHandlerRequest,
    GraphQLHandlerResponse,
    SchemaSlicingConfig,
    ZenStackClientLike,
} from './types.js';

type HandlerExecutionContext<TRequest, TContext> = {
    request: TRequest;
    context: TContext;
};

export interface CreateGraphQLApiHandlerOptions<
    TClient extends ZenStackClientLike = ZenStackClientLike,
    TRequest = unknown,
    TContext = undefined,
    TCacheKey = string,
> extends Omit<
        CreateZenStackGraphQLSchemaFactoryOptions<
            TClient,
            HandlerExecutionContext<TRequest, TContext>,
            TCacheKey
        >,
        'getClient' | 'getSlicing' | 'getCacheKey'
    > {
    getClient(request: TRequest, context: TContext): TClient | Promise<TClient>;
    getContext?(request: TRequest): TContext | Promise<TContext>;
    getSlicing?(
        request: TRequest,
        context: TContext
    ): SchemaSlicingConfig | undefined | Promise<SchemaSlicingConfig | undefined>;
    getCacheKey?(input: {
        request: TRequest;
        context: TContext;
        slicing: SchemaSlicingConfig | undefined;
    }): TCacheKey | Promise<TCacheKey>;
}

type GraphQLOperationInput = {
    query: string;
    variables?: Record<string, unknown>;
    operationName?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function transportError(status: number, message: string): GraphQLHandlerResponse {
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

function getSearchParamValue(
    searchParams: GraphQLHandlerRequest['searchParams'],
    key: string
): unknown {
    if (!searchParams) {
        return undefined;
    }
    if (searchParams instanceof URL) {
        return searchParams.searchParams.get(key) ?? undefined;
    }
    if (searchParams instanceof URLSearchParams) {
        return searchParams.get(key) ?? undefined;
    }
    return searchParams[key];
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

function parseOperationInput(request: GraphQLHandlerRequest): GraphQLOperationInput {
    const method = request.method.toUpperCase();
    if (method === 'GET') {
        const query = getSearchParamValue(request.searchParams, 'query');
        if (typeof query !== 'string' || query.length === 0) {
            throw new Error('A GraphQL "query" string is required.');
        }
        return {
            query,
            variables: parseVariables(getSearchParamValue(request.searchParams, 'variables')),
            operationName:
                typeof getSearchParamValue(request.searchParams, 'operationName') === 'string'
                    ? (getSearchParamValue(request.searchParams, 'operationName') as string)
                    : undefined,
        };
    }

    if (method !== 'POST') {
        throw Object.assign(new Error(`Unsupported GraphQL method "${method}"`), {
            status: 405,
        });
    }

    const body = parseRequestBody(request.body);
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

function jsonResponse(body: unknown, status = 200): GraphQLHandlerResponse {
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
    TRequest = unknown,
    TContext = undefined,
    TCacheKey = string,
> {
    private readonly schemaFactory: ZenStackGraphQLSchemaFactory<
        HandlerExecutionContext<TRequest, TContext>,
        TCacheKey
    >;

    constructor(
        private readonly options: CreateGraphQLApiHandlerOptions<
            TClient,
            TRequest,
            TContext,
            TCacheKey
        >
    ) {
        const { getClient, getContext, getSlicing, getCacheKey, ...schemaOptions } = options;
        this.schemaFactory = createZenStackGraphQLSchemaFactory({
            ...schemaOptions,
            getClient: async (value) => getClient(value.request, value.context),
            getSlicing: getSlicing
                ? async (value) => getSlicing(value.request, value.context)
                : undefined,
            getCacheKey: getCacheKey
                ? async (value) =>
                      getCacheKey({
                          request: value.context.request,
                          context: value.context.context,
                          slicing: value.slicing,
                      })
                : undefined,
        });
    }

    async getSchema(request: TRequest): Promise<GraphQLSchema> {
        const context = await this.resolveContext(request);
        return this.schemaFactory.getSchema({ request, context });
    }

    async execute(
        request: TRequest,
        input: GraphQLOperationInput
    ): Promise<ExecutionResult> {
        const context = await this.resolveContext(request);
        return this.schemaFactory.execute({
            contextValue: { request, context },
            source: input.query,
            variableValues: input.variables,
            operationName: input.operationName,
        });
    }

    async handle(
        request: GraphQLHandlerRequest<TRequest>
    ): Promise<GraphQLHandlerResponse> {
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

        const result = await this.execute(request.request, input);
        return jsonResponse(result, 200);
    }

    private async resolveContext(request: TRequest): Promise<TContext> {
        return (await this.options.getContext?.(request)) as TContext;
    }
}

export type {
    GraphQLHandlerRequest,
    GraphQLHandlerResponse,
};
