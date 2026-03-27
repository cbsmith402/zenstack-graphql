import type {
    ExecutionResult,
    GraphQLArgs,
    GraphQLSchema,
} from 'graphql';

import { graphql } from './execution.js';
import { createZenStackGraphQLSchema } from './schema.js';
import type {
    CreateZenStackGraphQLSchemaOptions,
    SchemaInput,
    SchemaSlicingConfig,
    ZenStackClientLike,
} from './types.js';

export interface CreateZenStackGraphQLSchemaFactoryOptions<
    TClient extends ZenStackClientLike = ZenStackClientLike,
    TContext = unknown,
    TCacheKey = string,
    TSchema extends SchemaInput = SchemaInput,
> extends Omit<CreateZenStackGraphQLSchemaOptions<TClient, TContext, TSchema>, 'slicing'> {
    getSlicing?(
        context: TContext
    ): SchemaSlicingConfig | undefined | Promise<SchemaSlicingConfig | undefined>;
    getCacheKey?(input: {
        context: TContext;
        slicing: SchemaSlicingConfig | undefined;
    }): TCacheKey | Promise<TCacheKey>;
}

export interface ZenStackGraphQLSchemaFactory<
    TContext = unknown,
    TCacheKey = string,
> {
    getSchema(context: TContext): Promise<GraphQLSchema>;
    execute(args: Omit<GraphQLArgs, 'schema'> & { contextValue: TContext }): Promise<ExecutionResult>;
    clear(): void;
    delete(key: TCacheKey): boolean;
}

function stableSerialize(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

export function createZenStackGraphQLSchemaFactory<
    TClient extends ZenStackClientLike,
    TContext,
    TCacheKey = string,
    TSchema extends SchemaInput = SchemaInput,
>(
    options: CreateZenStackGraphQLSchemaFactoryOptions<TClient, TContext, TCacheKey, TSchema>
): ZenStackGraphQLSchemaFactory<TContext, TCacheKey> {
    const { getSlicing, getCacheKey, ...schemaOptions } = options;
    const cache = new Map<TCacheKey, GraphQLSchema>();

    async function resolveSlicing(context: TContext) {
        return (await getSlicing?.(context)) ?? undefined;
    }

    async function resolveCacheKey(
        context: TContext,
        slicing: SchemaSlicingConfig | undefined
    ) {
        if (getCacheKey) {
            return getCacheKey({ context, slicing });
        }
        return stableSerialize(slicing ?? {}) as TCacheKey;
    }

    async function getSchema(context: TContext) {
        const slicing = await resolveSlicing(context);
        const cacheKey = await resolveCacheKey(context, slicing);
        const existing = cache.get(cacheKey);
        if (existing) {
            return existing;
        }

        const schema = createZenStackGraphQLSchema({
            ...schemaOptions,
            slicing,
        });
        cache.set(cacheKey, schema);
        return schema;
    }

    return {
        async getSchema(context) {
            return getSchema(context);
        },
        async execute(args) {
            const schema = await getSchema(args.contextValue);
            return graphql({
                ...args,
                schema,
            });
        },
        clear() {
            cache.clear();
        },
        delete(key) {
            return cache.delete(key);
        },
    };
}
