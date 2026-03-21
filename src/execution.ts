import { AsyncLocalStorage } from 'node:async_hooks';

import {
    getOperationAST,
    graphql as baseGraphql,
    parse,
    type ExecutionResult,
    type GraphQLArgs,
    type GraphQLSchema,
} from 'graphql';

import type {
    ZenStackClientLike,
    ZenStackGraphQLExecutionMetadata,
} from './types.js';

const executionClientStorage = new AsyncLocalStorage<ZenStackClientLike>();
const executionMetadata = new WeakMap<
    GraphQLSchema,
    ZenStackGraphQLExecutionMetadata<ZenStackClientLike, unknown>
>();

class TransactionRollbackSignal extends Error {
    constructor(readonly result: ExecutionResult) {
        super('Rollback GraphQL mutation transaction');
    }
}

export function registerExecutionMetadata<
    TClient extends ZenStackClientLike,
    TContext = unknown,
>(
    schema: GraphQLSchema,
    metadata: ZenStackGraphQLExecutionMetadata<TClient, TContext>
) {
    executionMetadata.set(
        schema,
        metadata as ZenStackGraphQLExecutionMetadata<ZenStackClientLike, unknown>
    );
}

export function getExecutionClient<TClient extends ZenStackClientLike>() {
    return executionClientStorage.getStore() as TClient | undefined;
}

export async function graphql(args: GraphQLArgs) {
    const metadata = executionMetadata.get(args.schema);
    if (!metadata) {
        return baseGraphql(args);
    }

    let operation = null;
    try {
        const document = parse(args.source);
        operation = getOperationAST(document, args.operationName);
    } catch {
        return baseGraphql(args);
    }

    if (operation?.operation !== 'mutation') {
        return baseGraphql(args);
    }

    const client = await metadata.getClient(args.contextValue);
    if (typeof client.$transaction !== 'function') {
        return baseGraphql(args);
    }

    try {
        return await client.$transaction(async (transactionClient) =>
            executionClientStorage.run(transactionClient, async () => {
                const result = await baseGraphql(args);
                if (result.errors?.length) {
                    throw new TransactionRollbackSignal(result);
                }
                return result;
            })
        );
    } catch (error) {
        if (error instanceof TransactionRollbackSignal) {
            return {
                ...error.result,
                data: null,
            };
        }
        throw error;
    }
}
