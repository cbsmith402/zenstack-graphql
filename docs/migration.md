# Hasura Migration Checklist

This adapter is a good fit when you mainly use Hasura as:

- a CRUD GraphQL layer over relational models
- a query/mutation surface with filters, aggregates, and nested reads
- a role-pruned schema sitting in front of an application data model

## Good Migration Candidates

- Table-style queries and mutations
- `*_aggregate` queries
- `insert_*` / `update_*` / `delete_*` flows
- `on_conflict` upserts
- Role-specific schema variants
- Custom business operations that can be rewritten as ZenStack procedures

## Areas To Review Before Migrating

- Any use of subscriptions
- Any use of remote schemas
- Any use of database-native SQL functions exposed directly in GraphQL
- Any reliance on cursor pagination semantics
- Any use of niche backend-specific Hasura operators that are not backed by ZenStack filters yet

## Practical Migration Steps

1. Start with a representative Hasura query set.
2. Map your models into ZenStack and verify the generated CRUD roots.
3. If your existing documents use table-style root names, enable `naming: 'hasura-table'`.
4. If your documents use Hasura/Postgres scalar names like `uuid`, `timestamptz`, or `jsonb`, enable `scalarAliases: 'hasura'`.
5. Replace role-specific introspection with schema factory slices keyed by request context.
6. Move custom actions into ZenStack procedures where possible.
7. Use `extensions.query` and `extensions.mutation` only for the operations that do not belong in ZModel.
8. Keep a short incompatibility list for your team so unsupported Hasura features are visible early.

## Suggested Validation Pass

- Snapshot the generated GraphQL SDL per role.
- Run golden queries for your highest-traffic reads.
- Run multi-field mutation rollback tests if you rely on atomic mutation documents.
- Check provider-specific filters against the real database you plan to use.
- Confirm every intentionally unsupported Hasura feature has a replacement plan.
