# zenstack-graphql

`zenstack-graphql` is a standalone GraphQL adapter for ZenStack-style model metadata. It generates a framework-agnostic `GraphQLSchema` with Hasura-like CRUD roots, model-driven filters and ordering, aggregates, and core insert/update/delete mutations.

## Usage

```ts
import { createZenStackGraphQLSchema } from 'zenstack-graphql';

const schema = createZenStackGraphQLSchema({
    schema: {
        models: [
            {
                name: 'User',
                fields: [
                    { name: 'id', kind: 'scalar', type: 'Int', isId: true },
                    { name: 'name', kind: 'scalar', type: 'String' },
                ],
            },
        ],
    },
    async getClient(context) {
        return context.db;
    },
});
```

## Public API

- `createZenStackGraphQLSchema({ schema, getClient, naming, features, scalars, hooks })`
- `normalizeSchema(schema)`
- `normalizeError(error)`

The generated schema uses Hasura-like defaults:

- Query roots: `users`, `users_by_pk`, `users_aggregate`
- Mutation roots: `insert_users`, `insert_users_one`, `update_users`, `update_users_by_pk`, `delete_users`, `delete_users_by_pk`

## Notes

- The adapter accepts a normalized metadata object today so it can work as a standalone package before being wired into a full ZenStack V3 repository.
- Delegates are expected to look Prisma-like (`findMany`, `findUnique`, `aggregate`, `create`, `update`, `delete`, and optional bulk variants).
- Subscriptions, conflict clauses, and custom procedures are intentionally deferred.

## Next.js Demo

A runnable sample app lives in `examples/nextjs-demo`.

It now uses a real ZenStack schema at `examples/nextjs-demo/zenstack/schema.zmodel`, generates the
typed ZenStack schema with `zenstack generate`, boots a SQLite database, and serves the local
GraphQL adapter through a Next.js API route.

```bash
cd examples/nextjs-demo
npm install
npm run dev
```

Or from the repo root:

```bash
npm run demo:dev
```
