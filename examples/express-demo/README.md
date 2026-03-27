# Express Demo

This example shows `zenstack-graphql` mounted through ZenStack's real Express server adapter,
using `GraphQLApiHandler` as the framework-agnostic API handler.

## Run

```bash
npm install
npm run dev
```

Then visit:

- `http://localhost:4001/`
- `http://localhost:4001/api/schema`
- `http://localhost:4001/api/graphql`

Use the `x-hasura-role` header with `admin` or `user` to switch schema slices.
