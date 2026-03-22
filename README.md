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
- `createZenStackGraphQLSchemaFactory({ schema, getClient, getSlicing, getCacheKey, ... })`
- `normalizeSchema(schema)`
- `normalizeError(error)`

The generated schema uses Hasura-like defaults:

- Query roots: `users`, `users_by_pk`, `users_aggregate`
- Mutation roots: `insert_users`, `insert_users_one`, `update_users`, `update_users_by_pk`, `delete_users`, `delete_users_by_pk`
- String filters include Hasura-style pattern operators like `_like`, `_nlike`, `_ilike`, and `_nilike`, plus extended prefix/suffix/contains variants
- Provider-specific filters now include PostgreSQL scalar-list operators (`has`, `hasEvery`, `hasSome`, `isEmpty`) and ZenStack-style `Json` filters with JSON-path support
- Comparable scalar filters include `_between`
- Strongly typed JSON / typedef-backed fields can be filtered recursively, including list-object filters with `some`, `every`, and `none`
- `insert_*` and `insert_*_one` support `on_conflict`
- `*_insert_input` supports nested relation `data` inserts
- `*_set_input` supports relation-aware updates for the nested mutation shapes supported by the underlying ZenStack ORM
- To-many relation filters support the ORM-backed `some`, `every`, and `none` semantics via additive GraphQL fields like `posts_some`, `posts_every`, and `posts_none`
- `features.computedFields` enables read-only `@computed` fields detected from ZenStack-generated metadata
- `slicing` supports schema pruning with ZenStack-style model, operation, procedure, and filter slicing, plus GraphQL field visibility pruning for role-specific schemas
- `createZenStackGraphQLSchemaFactory` caches one generated schema per slice key, which makes role-aware introspection and execution much easier
- ZModel `procedure` and `mutation procedure` definitions are exposed as GraphQL query and mutation roots via `client.$procs`
- `extensions.query` and `extensions.mutation` let you attach manual GraphQL root fields that receive the same request-scoped ZenStack client as generated resolvers
- `*_by_pk` roots are emitted only for real primary keys
- Relation aggregate `order_by` on parent collections is currently supported only for `count`, matching the documented ORM `orderBy: { relation: { _count: ... } }` shape
- `distinct_on` is generated only for providers where the ORM supports `distinct`

## Compatibility Snapshot

This adapter is aiming for "mostly painless for common Hasura CRUD use cases", not full Hasura platform parity.

Supported well today:

- Hasura-like list, `*_by_pk`, and `*_aggregate` query roots
- Core insert, update, and delete mutation roots with `returning`
- `on_conflict` on `insert_*` and `insert_*_one`
- Nested relation inserts and the supported nested relation update shapes exposed by ZenStack ORM
- Aggregates, relation aggregate fields, and parent `order_by` by relation `count`
- Hasura-style filtering and ordering, including `_between`, relation `some` / `every` / `none`, and provider-gated `distinct_on`
- ZenStack custom procedures as GraphQL roots
- Manual custom root resolvers through `extensions`
- Role-aware schema pruning through `slicing` or the schema factory
- Request-wide mutation transactions when the client exposes `$transaction`

Supported, but with explicit limits:

- Relation aggregate `order_by` only supports `count`
- Provider-specific operators only appear where ZenStack metadata says the backend supports them
- Typed JSON / typedef filters are supported recursively for scalar, enum, typedef, and list-of-typedef fields, but not arbitrary relation fields nested inside typedefs
- Role-aware schemas are static per slice key; auth enforcement still belongs in the ZenStack client you provide

Intentionally unsupported right now:

- Subscriptions
- Hasura remote schemas
- Auto-generated database-native SQL function/procedure roots
- Cursor pagination
- Relation aggregate ordering beyond ORM-backed `count`
- Any feature that would require in-memory query semantics instead of safe ORM lowering

See [docs/compatibility.md](/Users/cbsmith/Projects/zenstack-graphql/docs/compatibility.md) for the longer compatibility matrix and [docs/migration.md](/Users/cbsmith/Projects/zenstack-graphql/docs/migration.md) for a practical Hasura migration checklist.

## Role-aware schemas

If you want different GraphQL schemas per role, use the schema factory and derive `slicing`
from request context.

```ts
import {
    createZenStackGraphQLSchemaFactory,
} from 'zenstack-graphql';

const factory = createZenStackGraphQLSchemaFactory({
    schema,
    getClient: async (context) => context.db,
    getSlicing(context) {
        return context.role === 'admin'
            ? undefined
            : {
                  models: {
                      user: {
                          excludedFields: ['age'],
                          excludedOperations: ['deleteMany', 'deleteByPk'],
                      },
                  },
              };
    },
    getCacheKey({ context }) {
        return context.role;
    },
});

const graphqlSchema = await factory.getSchema(context);
const result = await factory.execute({
    contextValue: context,
    source: '{ users { id name } }',
});
```

## Notes

- The adapter accepts a normalized metadata object today so it can work as a standalone package before being wired into a full ZenStack V3 repository.
- Delegates are expected to look Prisma-like (`findMany`, `findUnique`, `aggregate`, `create`, `update`, `delete`, and optional bulk variants).
- Provider capabilities are normalized from the schema metadata so backend-specific filter behavior can be gated cleanly as the adapter grows.
- ZenStack custom procedures are supported; database-native SQL routines are not auto-generated today.

## Next.js Demo

A runnable sample app lives in `examples/nextjs-demo`.

It now uses a real ZenStack schema at `examples/nextjs-demo/zenstack/schema.zmodel`, generates the
typed ZenStack schema with `zenstack generate`, boots a SQLite database, and serves the local
GraphQL adapter through a Next.js API route. The demo also supports Hasura-style role selection
with the `x-hasura-role` header and swaps between cached pruned schemas in the browser.

The playground includes examples for:

- Nested reads and aggregates
- CRUD mutations, nested inserts, and `on_conflict`
- Atomic rollback across multiple mutation fields
- JSON-path filters and `_between`
- ZenStack procedures and manual extension roots
- Role-pruned schemas with `x-hasura-role`

```bash
cd examples/nextjs-demo
npm install
npm run dev
```

Or from the repo root:

```bash
npm run demo:dev
```
