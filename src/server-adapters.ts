import { GraphQLApiHandler } from './api-handler.js';
import type { ZenStackClientLike } from './types.js';

export interface CreateFetchGraphQLHandlerOptions<
    TClient extends ZenStackClientLike = ZenStackClientLike,
    TContext = undefined,
    TCacheKey = string,
> {
    apiHandler: GraphQLApiHandler<TClient, TContext, TCacheKey>;
    getClient(request: Request): TClient | Promise<TClient>;
    getContext?(request: Request): TContext | Promise<TContext>;
}

function applyHeaders(
    target: ResponseInit['headers'],
    headers?: Record<string, string>
) {
    if (!headers) {
        return;
    }

    if (target instanceof Headers || Array.isArray(target)) {
        for (const [key, value] of Object.entries(headers)) {
            if (target instanceof Headers) {
                target.set(key, value);
            } else {
                target.push([key, value]);
            }
        }
        return;
    }
}

function searchParamsToQuery(searchParams: URLSearchParams): Record<string, string | string[]> {
    const query: Record<string, string | string[]> = {};

    for (const [key, value] of searchParams.entries()) {
        const existing = query[key];
        if (existing === undefined) {
            query[key] = value;
        } else if (Array.isArray(existing)) {
            existing.push(value);
        } else {
            query[key] = [existing, value];
        }
    }

    return query;
}

export function createFetchGraphQLHandler<
    TClient extends ZenStackClientLike = ZenStackClientLike,
    TContext = undefined,
    TCacheKey = string,
>(
    options: CreateFetchGraphQLHandlerOptions<TClient, TContext, TCacheKey>
) {
    const { apiHandler, getClient, getContext } = options;

    return async function handleGraphQL(request: Request) {
        const body = request.method.toUpperCase() === 'POST' ? await request.text() : undefined;
        const url = new URL(request.url);
        const response = await apiHandler.handleRequest({
            client: await getClient(request),
            context: await getContext?.(request),
            method: request.method,
            path: url.pathname,
            query: searchParamsToQuery(url.searchParams),
            requestBody: body,
        });

        const headers = new Headers(response.headers);
        return new Response(JSON.stringify(response.body), {
            status: response.status,
            headers,
        });
    };
}
