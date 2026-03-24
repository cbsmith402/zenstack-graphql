import { GraphQLApiHandler, type CreateGraphQLApiHandlerOptions } from './api-handler.js';
import type { ZenStackClientLike } from './types.js';

type ExpressRequestLike = {
    method: string;
    headers?: Record<string, unknown>;
    query?: Record<string, unknown>;
    body?: unknown;
};

type ExpressResponseLike = {
    status(code: number): ExpressResponseLike;
    setHeader(name: string, value: string): void;
    json(body: unknown): unknown;
};

type HonoContextLike = {
    req: {
        raw: Request;
    };
};

function isExpressResponseLike(
    target: ResponseInit['headers'] | ExpressResponseLike
): target is ExpressResponseLike {
    return Boolean(target) && typeof target === 'object' && 'setHeader' in target;
}

function applyHeaders(target: ResponseInit['headers'] | ExpressResponseLike, headers?: Record<string, string>) {
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

    if (isExpressResponseLike(target)) {
        for (const [key, value] of Object.entries(headers)) {
            target.setHeader(key, value);
        }
    }
}

export function createFetchGraphQLHandler<
    TClient extends ZenStackClientLike = ZenStackClientLike,
>(
    options: CreateGraphQLApiHandlerOptions<TClient, Request, any, any>
) {
    const handler = new GraphQLApiHandler(options);

    return async function handleGraphQL(request: Request) {
        const body =
            request.method.toUpperCase() === 'POST'
                ? await request.text()
                : undefined;
        const response = await handler.handle({
            method: request.method,
            request,
            headers: request.headers,
            searchParams: new URL(request.url),
            body,
        });

        const headers = new Headers(response.headers);
        return new Response(JSON.stringify(response.body), {
            status: response.status,
            headers,
        });
    };
}

export function createNextGraphQLHandler<
    TClient extends ZenStackClientLike = ZenStackClientLike,
>(
    options: CreateGraphQLApiHandlerOptions<TClient, Request, any, any>
) {
    return createFetchGraphQLHandler(options);
}

export function createExpressGraphQLMiddleware<
    TClient extends ZenStackClientLike = ZenStackClientLike,
>(
    options: CreateGraphQLApiHandlerOptions<TClient, ExpressRequestLike, any, any>
) {
    const handler = new GraphQLApiHandler(options);

    return async function graphQLMiddleware(
        req: ExpressRequestLike,
        res: ExpressResponseLike,
        next?: (error: unknown) => void
    ) {
        try {
            const response = await handler.handle({
                method: req.method,
                request: req,
                headers: req.headers,
                searchParams: req.query,
                body: req.body,
            });
            applyHeaders(res, response.headers);
            return res.status(response.status).json(response.body);
        } catch (error) {
            if (next) {
                return next(error);
            }
            throw error;
        }
    };
}

export function createHonoGraphQLHandler<
    TClient extends ZenStackClientLike = ZenStackClientLike,
>(
    options: CreateGraphQLApiHandlerOptions<TClient, Request, any, any>
) {
    const handleFetch = createFetchGraphQLHandler(options);

    return async function graphQLHandler(context: HonoContextLike) {
        return handleFetch(context.req.raw);
    };
}
