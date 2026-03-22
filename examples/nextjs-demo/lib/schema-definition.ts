export const sampleOperations = [
    {
        label: 'Nested Query',
        description: 'Read real SQLite-backed ZenStack models with nested posts and aggregates.',
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

  users_aggregate(where: { role: { _eq: ADMIN } }) {
    aggregate {
      count
      avg {
        age
      }
      max {
        age
      }
    }
  }
}`,
        variables: '{}',
    },
    {
        label: 'Mutation Flow',
        description: 'Mutate real rows in SQLite through the generated ZenStack schema.',
        query: `mutation MutationFlow {
  insert_users_one(object: { name: "Cara", age: 25, role: USER }) {
    id
    name
    age
    role
  }

  update_users(where: { id: { _eq: 2 } }, _set: { name: "Benny" }, _inc: { age: 1 }) {
    affected_rows
    returning {
      id
      name
      age
    }
  }
}`,
        variables: '{}',
    },
    {
        label: 'Nested Insert + Upsert',
        description: 'Create related rows in one mutation and update an existing row with on_conflict.',
        query: `mutation NestedInsertAndUpsert {
  insert_users_one(
    object: {
      name: "Cara"
      age: 25
      role: USER
      posts: {
        data: [
          { title: "Nested One", views: 2 }
          { title: "Nested Two", views: 7 }
        ]
      }
    }
  ) {
    id
    name
    posts(order_by: [{ views: desc }]) {
      id
      title
      views
    }
  }

  upsert_user: insert_users_one(
    object: { id: 2, name: "Benny", age: 21, role: USER }
    on_conflict: {
      constraint: User_pkey
      update_columns: [name, age]
    }
  ) {
    id
    name
    age
    role
  }
}`,
        variables: '{}',
    },
    {
        label: 'Bulk Upsert',
        description: 'Use insert_many with on_conflict to update existing rows and insert new ones together.',
        query: `mutation BulkUpsert {
  insert_users(
    objects: [
      { id: 2, name: "Benny", age: 21, role: USER }
      { id: 9, name: "Drew", age: 28, role: USER }
    ]
    on_conflict: {
      constraint: User_pkey
      update_columns: [name, age]
    }
  ) {
    affected_rows
    returning {
      id
      name
      age
      role
    }
  }
}`,
        variables: '{}',
    },
    {
        label: 'Relation Update',
        description: 'Update related records through parent and child mutation roots.',
        query: `mutation RelationUpdate {
  add_post: update_users(
    where: { name: { _eq: "Ben" } }
    _set: {
      posts: {
        create: [{ title: "Nested Create On Update", views: 4 }]
      }
    }
  ) {
    affected_rows
    returning {
      id
      name
      posts(order_by: [{ id: asc }]) {
        id
        title
        views
      }
    }
  }

  rename_author: update_posts(
    where: { title: { _eq: "GraphQL Adapter" } }
    _set: {
      author: {
        update: {
          _set: { name: "Ben Updated Through Post" }
        }
      }
    }
  ) {
    affected_rows
    returning {
      id
      title
      author {
        id
        name
      }
    }
  }
}`,
        variables: '{}',
    },
    {
        label: 'Filtered Search',
        description: 'Use Hasura-style filters against relation data in SQLite.',
        query: `query RelatedFilter {
  users(where: { posts: { title: { _ilike: "%Hasura%" } } }) {
    id
    name
    posts(where: { title: { _ilike: "%Hasura%" } }) {
      id
      title
    }
  }
}`,
        variables: '{}',
    },
    {
        label: 'JSON Filter',
        description:
            'Filter a real SQLite-backed Json field with ZenStack JSON-path operators through the generated GraphQL schema.',
        query: `query JsonFilter {
  users(
    where: {
      profile: {
        path: "$.bio"
        string_contains: "developer"
      }
    }
    order_by: [{ id: asc }]
  ) {
    id
    name
    profile
  }
}`,
        variables: '{}',
    },
    {
        label: 'Between Filter',
        description:
            'Use the ORM-backed _between operator for comparable scalar fields in a Hasura-style where clause.',
        query: `query BetweenFilter {
  users(
    where: { age: { _between: [20, 40] } }
    order_by: [{ age: asc }]
  ) {
    id
    name
    age
  }
}`,
        variables: '{}',
    },
    {
        label: 'Procedure Root',
        description:
            'Call a real ZenStack custom procedure defined in ZModel and exposed as a GraphQL query root.',
        query: `query ProcedureRoot {
  getUserFeeds(userId: 1, limit: 2) {
    id
    title
    views
    author {
      id
      name
    }
  }
}`,
        variables: '{}',
    },
    {
        label: 'Manual Extension',
        description:
            'Call a custom GraphQL root field added through extensions.query while still using the same request-scoped ZenStack client.',
        query: `query ManualExtension {
  demoSummary
}`,
        variables: '{}',
    },
    {
        label: 'Role-pruned Query',
        description:
            'Switch the playground role to "user" and rerun this query to see the age field disappear from the generated schema and validation.',
        query: `query RolePrunedQuery {
  users(order_by: [{ id: asc }]) {
    id
    name
  }
}`,
        variables: '{}',
    },
    {
        label: 'Relation Aggregate',
        description: 'Query Hasura-style relation aggregate fields generated from the ZenStack models.',
        query: `query RelationAggregate {
  users(order_by: [{ id: asc }]) {
    id
    name
    posts_aggregate(order_by: [{ views: desc }]) {
      aggregate {
        count
        sum {
          views
        }
        max {
          views
        }
      }
      nodes {
        id
        title
        views
      }
    }
  }
}`,
        variables: '{}',
    },
    {
        label: 'Atomic Rollback',
        description:
            'The first insert would succeed on its own, but the second one fails, so the whole mutation rolls back.',
        query: `mutation AtomicRollback {
  insert_users_one(object: { name: "Rollback Riley", age: 41, role: USER }) {
    id
    name
  }

  insert_posts_one(object: { title: "Broken Foreign Key", authorId: 999999, views: 1 }) {
    id
    title
  }
}`,
        variables: '{}',
    },
];

export const zmodelSource = `datasource db {
  provider = 'sqlite'
  url = env('DATABASE_URL')
}

enum Role {
  USER
  ADMIN
}

model User {
  id        Int      @id @default(autoincrement())
  name      String
  age       Int
  role      Role     @default(USER)
  profile   Json?
  createdAt DateTime @default(now())
  posts     Post[]
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  views     Int      @default(0)
  createdAt DateTime @default(now())
  author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
  authorId  Int
}

procedure getUserFeeds(userId: Int, limit: Int?) : Post[]`;
