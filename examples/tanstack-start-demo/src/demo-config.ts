export type DemoRole = 'admin' | 'user';

export const DEFAULT_DEMO_ROLE: DemoRole = 'admin';
export const DEMO_ROLE_HEADER = 'x-hasura-role';

export const sampleOperations = [
    {
        label: 'Nested Query',
        description: 'Read SQLite-backed ZenStack rows with nested posts.',
        query: `query NestedUsers {
  users(order_by: [{ age: desc }]) {
    id
    name
    age
    role
    posts(order_by: [{ id: asc }]) {
      id
      title
      views
    }
  }
}`,
    },
    {
        label: 'Procedure Root',
        description: 'Call a ZenStack procedure exposed as a GraphQL query.',
        query: `query ProcedureRoot {
  getUserFeeds(userId: 1, limit: 2) {
    id
    title
    views
  }
}`,
    },
    {
        label: 'Relay Connection',
        description: 'Use the optional Relay connection layer alongside Hasura-style roots.',
        query: `query RelayUsers {
  users_connection(first: 2, order_by: [{ id: asc }]) {
    edges {
      cursor
      node {
        id
        name
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`,
    },
];
