# Hasura Compatibility

`zenstack-graphql` is designed to cover the common "Hasura as a CRUD GraphQL layer" use case on top of ZenStack V3. It is not trying to reproduce the entire Hasura product surface.

## Query Surface

Supported:

- List roots: `<models>`
- Primary-key roots: `<models>_by_pk`
- Aggregate roots: `<models>_aggregate`
- Relay roots: `<models>_connection` and `node(id:)` when `relay.enabled` is on
- Nested relation reads
- Nested Relay relation connections like `posts_connection`
- Nested relation aggregate fields like `posts_aggregate`
- Filtering with Hasura-style comparison operators, relation filters, and provider-aware JSON operators
- Ordering, including ORM-backed relation `count` ordering
- Offset pagination via `limit` and `offset`

Partially supported:

- `distinct_on`: generated only for providers where ZenStack exposes distinct support
- Relation aggregate `order_by`: only `count` is supported today
- Typed JSON filters: supported for typedef-backed scalar/object/list structures, but not arbitrary nested relations inside typedefs
- Relay uses a parallel type layer (`UserNode`, `PostNode`, etc.) so it does not overwrite existing Hasura-style model object types

Not supported:

- Cursor pagination
- Subscriptions
- Relation aggregate ordering for `sum`, `avg`, `min`, or `max`
- Features that would require in-memory post-processing to fake unsupported ORM behavior

## Mutation Surface

Supported:

- `insert_*`
- `insert_*_one`
- `update_*`
- `update_*_by_pk`
- `delete_*`
- `delete_*_by_pk`
- `returning` payloads
- `on_conflict` for `insert_*` and `insert_*_one`
- Nested relation inserts
- The nested relation update shapes that map cleanly to ZenStack ORM
- Request-wide mutation transactions when the client exposes `$transaction`

Partially supported:

- Nested relation updates are intentionally limited to the shapes the underlying ORM supports and the adapter can lower safely

Not supported:

- Subscription-triggered mutation workflows
- Async action semantics
- Auto-generated database-native function/procedure mutations

## Custom Business Logic

Supported:

- ZenStack `procedure` and `mutation procedure` roots through `client.$procs`
- Manual root fields through `extensions.query` and `extensions.mutation`

Not supported:

- Hasura remote schemas
- Hasura action webhooks as a first-class generated concept
- Automatic database-function introspection

## Auth And Role Shape

Supported:

- Runtime auth enforcement through the request-scoped ZenStack client
- Static per-role or per-slice schema pruning through `slicing`
- Cached role-aware schema generation through `createZenStackGraphQLSchemaFactory`

Not supported:

- Automatic mapping from auth claims to pruning rules
- Built-in "allowed roles" validation
- A separate Hasura-like permission DSL inside this adapter

## Guiding Principle

If a feature cannot be lowered safely to the ZenStack ORM or a documented provider capability, the adapter prefers to omit it rather than emulate it with surprising semantics.
