import type { SchemaSlicingConfig } from './types.js';

export const HASURA_ROLE_HEADER = 'x-hasura-role';

export type HasuraHeadersLike = Headers | Record<string, unknown> | undefined | null;

export type HasuraRoleContext<TRole extends string = string> = {
    role: TRole;
};

export interface CreateHasuraCompatibilityHelpersOptions<
    TRequest = unknown,
    TRole extends string = string,
> {
    defaultRole: TRole;
    getHeaders(request: TRequest): HasuraHeadersLike;
    headerName?: string;
    normalizeRole?(role: string | undefined): TRole;
    getSlicing?(role: TRole): SchemaSlicingConfig | undefined;
}

export function getHasuraHeaderValue(headers: HasuraHeadersLike, name: string): string | undefined {
    if (!headers) {
        return undefined;
    }

    if (headers instanceof Headers) {
        return headers.get(name) ?? undefined;
    }

    const directValue = headers[name];
    if (typeof directValue === 'string') {
        return directValue;
    }
    if (Array.isArray(directValue)) {
        const firstValue = directValue.find((value) => typeof value === 'string');
        return typeof firstValue === 'string' ? firstValue : undefined;
    }

    const lowerCaseValue = headers[name.toLowerCase()];
    if (typeof lowerCaseValue === 'string') {
        return lowerCaseValue;
    }
    if (Array.isArray(lowerCaseValue)) {
        const firstValue = lowerCaseValue.find((value) => typeof value === 'string');
        return typeof firstValue === 'string' ? firstValue : undefined;
    }

    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() !== name.toLowerCase()) {
            continue;
        }
        if (typeof value === 'string') {
            return value;
        }
        if (Array.isArray(value)) {
            const firstValue = value.find((item) => typeof item === 'string');
            return typeof firstValue === 'string' ? firstValue : undefined;
        }
    }

    return undefined;
}

export function createHasuraCompatibilityHelpers<
    TRequest = unknown,
    TRole extends string = string,
>(options: CreateHasuraCompatibilityHelpersOptions<TRequest, TRole>) {
    const headerName = options.headerName ?? HASURA_ROLE_HEADER;

    function normalizeRole(input: string | undefined): TRole {
        return options.normalizeRole?.(input) ?? ((input ?? options.defaultRole) as TRole);
    }

    function getRoleFromHeaders(headers: HasuraHeadersLike): TRole {
        return normalizeRole(getHasuraHeaderValue(headers, headerName));
    }

    function getRole(request: TRequest): TRole {
        return getRoleFromHeaders(options.getHeaders(request));
    }

    function getContext(request: TRequest): HasuraRoleContext<TRole> {
        return {
            role: getRole(request),
        };
    }

    function getSlicing(
        _request: TRequest,
        context: HasuraRoleContext<TRole>
    ): SchemaSlicingConfig | undefined {
        return options.getSlicing?.(context.role);
    }

    function getCacheKey(input: { context: HasuraRoleContext<TRole> }) {
        return input.context.role;
    }

    return {
        headerName,
        defaultRole: options.defaultRole,
        normalizeRole,
        getRoleFromHeaders,
        getRole,
        getContext,
        getSlicing,
        getCacheKey,
    };
}
