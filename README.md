# zenstack-graphql

`zenstack-graphql` is a standalone GraphQL adapter for ZenStack-style model metadata. It generates a framework-agnostic `GraphQLSchema` with Hasura-like CRUD roots, model-driven filters and ordering, aggregates, nested relation inserts, core insert/update/delete mutations, ZenStack procedure roots, and optional custom root resolvers.

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

- `createZenStackGraphQLSchema({ schema, getClient, naming, features, slicing, scalars, hooks, extensions })`
- `normalizeSchema(schema)`
- `normalizeError(error)`

The generated schema uses Hasura-like defaults:

- Query roots: `users`, `users_by_pk`, `users_aggregate`
- Mutation roots: `insert_users`, `insert_users_one`, `update_users`, `update_users_by_pk`, `delete_users`, `delete_users_by_pk`
- String filters include Hasura-style pattern operators like `_like`, `_nlike`, `_ilike`, and `_nilike`, plus extended prefix/suffix/contains variants
- Provider-specific filters now include PostgreSQL scalar-list operators (`has`, `hasEvery`, `hasSome`, `isEmpty`) and ZenStack-style `Json` filters with JSON-path support
- `insert_*` and `insert_*_one` support `on_conflict`
- `*_insert_input` supports nested relation `data` inserts
- `*_set_input` supports relation-aware updates for the nested mutation shapes supported by the underlying ZenStack ORM
- `features.computedFields` enables read-only `@computed` fields detected from ZenStack-generated metadata
- `slicing` supports schema pruning with ZenStack-style model, operation, procedure, and filter slicing, plus GraphQL field visibility pruning for role-specific schemas
- ZModel `procedure` and `mutation procedure` definitions are exposed as GraphQL query and mutation roots via `client.$procs`
- `extensions.query` and `extensions.mutation` let you attach manual GraphQL root fields that receive the same request-scoped ZenStack client as generated resolvers
- `*_by_pk` roots are emitted only for real primary keys

## Notes

- The adapter accepts a normalized metadata object today so it can work as a standalone package before being wired into a full ZenStack V3 repository.
- Delegates are expected to look Prisma-like (`findMany`, `findUnique`, `aggregate`, `create`, `update`, `delete`, and optional bulk variants).
- Provider capabilities are normalized from the schema metadata so backend-specific filter behavior can be gated cleanly as the adapter grows.
- Subscriptions and custom procedures are intentionally deferred.

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
