import type { ModelDefinition, ZenStackClientLike } from '../src/index.js';

type UserRecord = {
    id: number;
    name: string;
    age: number;
    role: 'USER' | 'ADMIN';
};

type PostRecord = {
    id: number;
    title: string;
    authorId: number;
    views: number;
};

type DataStore = {
    users: UserRecord[];
    posts: PostRecord[];
};

type ModelName = 'User' | 'Post';
type EntityRecord = UserRecord | PostRecord;
type QueryArgs = {
    where?: Record<string, unknown>;
    orderBy?: Record<string, unknown> | Record<string, unknown>[];
    distinct?: string[];
    take?: number;
    skip?: number;
    select?: Record<string, unknown>;
    data?: Record<string, unknown> | Record<string, unknown>[];
    _count?: Record<string, unknown>;
    _avg?: Record<string, unknown>;
    _sum?: Record<string, unknown>;
    _min?: Record<string, unknown>;
    _max?: Record<string, unknown>;
    create?: Record<string, unknown> | Record<string, unknown>[];
    update?: Record<string, unknown>;
};

export const schema: {
    models: ModelDefinition[];
    enums: { name: string; values: string[] }[];
} = {
    models: [
        {
            name: 'User',
            fields: [
                { name: 'id', kind: 'scalar', type: 'Int', isId: true },
                { name: 'name', kind: 'scalar', type: 'String' },
                { name: 'age', kind: 'scalar', type: 'Int' },
                { name: 'role', kind: 'enum', type: 'Role' },
                { name: 'posts', kind: 'relation', type: 'Post', isList: true, isNullable: false },
            ],
        },
        {
            name: 'Post',
            fields: [
                { name: 'id', kind: 'scalar', type: 'Int', isId: true },
                { name: 'title', kind: 'scalar', type: 'String' },
                { name: 'authorId', kind: 'scalar', type: 'Int' },
                { name: 'views', kind: 'scalar', type: 'Int' },
                { name: 'author', kind: 'relation', type: 'User', isNullable: false },
            ],
        },
    ],
    enums: [
        {
            name: 'Role',
            values: ['USER', 'ADMIN'],
        },
    ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneStore(seed?: Partial<DataStore>): DataStore {
    return {
        users: seed?.users?.map((entry) => ({ ...entry })) ?? [
            { id: 1, name: 'Ada', age: 34, role: 'ADMIN' },
            { id: 2, name: 'Ben', age: 19, role: 'USER' },
        ],
        posts: seed?.posts?.map((entry) => ({ ...entry })) ?? [
            { id: 10, title: 'ZenStack Intro', authorId: 1, views: 5 },
            { id: 11, title: 'Hasura Notes', authorId: 1, views: 8 },
            { id: 12, title: 'GraphQL Adapter', authorId: 2, views: 13 },
        ],
    };
}

function nextId(records: Array<{ id: number }>) {
    return records.reduce((max, record) => Math.max(max, record.id), 0) + 1;
}

function matchesScalarFilter(value: unknown, filter: unknown) {
    if (!isRecord(filter)) {
        return value === filter;
    }

    if (filter.equals !== undefined && value !== filter.equals) {
        return false;
    }
    if (filter.not !== undefined) {
        if (isRecord(filter.not)) {
            if (matchesScalarFilter(value, filter.not)) {
                return false;
            }
        } else if (value === filter.not) {
            return false;
        }
    }
    if (filter.gt !== undefined && !(Number(value) > Number(filter.gt))) {
        return false;
    }
    if (filter.gte !== undefined && !(Number(value) >= Number(filter.gte))) {
        return false;
    }
    if (filter.lt !== undefined && !(Number(value) < Number(filter.lt))) {
        return false;
    }
    if (filter.lte !== undefined && !(Number(value) <= Number(filter.lte))) {
        return false;
    }
    if (Array.isArray(filter.in) && !filter.in.includes(value)) {
        return false;
    }
    if (Array.isArray(filter.notIn) && filter.notIn.includes(value)) {
        return false;
    }

    const mode = filter.mode === 'insensitive' ? 'insensitive' : 'default';
    const normalize = (input: unknown) =>
        mode === 'insensitive' ? String(input ?? '').toLowerCase() : String(input ?? '');
    const comparableValue = normalize(value);

    if (filter.contains !== undefined && !comparableValue.includes(normalize(filter.contains))) {
        return false;
    }
    if (filter.startsWith !== undefined && !comparableValue.startsWith(normalize(filter.startsWith))) {
        return false;
    }
    if (filter.endsWith !== undefined && !comparableValue.endsWith(normalize(filter.endsWith))) {
        return false;
    }

    return true;
}

function compareValues(left: unknown, right: unknown) {
    if (left == null && right == null) {
        return 0;
    }
    if (left == null) {
        return -1;
    }
    if (right == null) {
        return 1;
    }

    if (left === right) {
        return 0;
    }

    const normalize = (value: unknown) => {
        if (value instanceof Date) {
            return value.getTime();
        }
        if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') {
            return value;
        }
        if (typeof value === 'boolean') {
            return Number(value);
        }
        return String(value ?? '');
    };

    const leftValue = normalize(left);
    const rightValue = normalize(right);
    return leftValue > rightValue ? 1 : -1;
}

function applyDistinct<T extends Record<string, unknown>>(records: T[], distinct?: string[]) {
    if (!distinct || distinct.length === 0) {
        return [...records];
    }

    const seen = new Set<string>();
    const result: T[] = [];
    for (const record of records) {
        const key = JSON.stringify(distinct.map((field) => record[field] ?? null));
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(record);
    }
    return result;
}

function sortRecords<T extends Record<string, unknown>>(records: T[], orderBy?: QueryArgs['orderBy']) {
    if (!orderBy) {
        return [...records];
    }

    const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
    const sorted = [...records];
    sorted.sort((left, right) => {
        for (const clause of clauses) {
            for (const [field, direction] of Object.entries(clause)) {
                const ordering =
                    typeof direction === 'string'
                        ? { sort: direction, nulls: undefined }
                        : isRecord(direction) &&
                            (direction.sort === 'asc' || direction.sort === 'desc')
                          ? {
                                sort: direction.sort,
                                nulls:
                                    direction.nulls === 'first' || direction.nulls === 'last'
                                        ? direction.nulls
                                        : undefined,
                            }
                          : null;
                if (!ordering) {
                    continue;
                }

                const leftValue = left[field];
                const rightValue = right[field];
                if (leftValue == null || rightValue == null) {
                    if (leftValue == null && rightValue == null) {
                        continue;
                    }

                    const nullComparison =
                        ordering.nulls === 'last'
                            ? leftValue == null
                                ? 1
                                : -1
                            : leftValue == null
                              ? -1
                              : 1;
                    return ordering.sort === 'desc' ? -nullComparison : nullComparison;
                }

                const comparison = compareValues(left[field], right[field]);
                if (comparison === 0) {
                    continue;
                }
                return ordering.sort === 'desc' ? -comparison : comparison;
            }
        }
        return 0;
    });
    return sorted;
}

function applyDataPatch(record: Record<string, unknown>, data: Record<string, unknown>) {
    for (const [key, value] of Object.entries(data)) {
        if (isRecord(value) && 'increment' in value) {
            record[key] = Number(record[key]) + Number(value.increment);
        } else {
            record[key] = value;
        }
    }
}

function getUserPosts(store: DataStore, user: UserRecord) {
    return store.posts.filter((post) => post.authorId === user.id);
}

function getPostAuthor(store: DataStore, post: PostRecord) {
    return store.users.find((user) => user.id === post.authorId) ?? null;
}

function recordMatches(
    store: DataStore,
    modelName: ModelName,
    record: EntityRecord,
    where?: Record<string, unknown>
): boolean {
    if (!where) {
        return true;
    }

    if (Array.isArray(where.AND)) {
        return where.AND.every(
            (entry) => isRecord(entry) && recordMatches(store, modelName, record, entry)
        );
    }
    if (Array.isArray(where.OR)) {
        return where.OR.some(
            (entry) => isRecord(entry) && recordMatches(store, modelName, record, entry)
        );
    }
    if (isRecord(where.NOT)) {
        return !recordMatches(store, modelName, record, where.NOT);
    }

    const recordMap = record as Record<string, unknown>;
    for (const [key, value] of Object.entries(where)) {
        if (key === 'AND' || key === 'OR' || key === 'NOT') {
            continue;
        }

        if (modelName === 'User' && key === 'posts') {
            if (!isRecord(value) || !isRecord(value.some)) {
                return false;
            }
            const someWhere = value.some;
            if (!getUserPosts(store, record as UserRecord).some((post) => recordMatches(store, 'Post', post, someWhere))) {
                return false;
            }
            continue;
        }

        if (modelName === 'Post' && key === 'author') {
            if (!isRecord(value) || !isRecord(value.is)) {
                return false;
            }
            const author = getPostAuthor(store, record as PostRecord);
            if (!author || !recordMatches(store, 'User', author, value.is)) {
                return false;
            }
            continue;
        }

        if (!matchesScalarFilter(recordMap[key], value)) {
            return false;
        }
    }

    return true;
}

function applySelect(
    store: DataStore,
    modelName: ModelName,
    record: EntityRecord,
    select?: Record<string, unknown>
): Record<string, unknown> {
    if (!select) {
        return { ...record };
    }

    const result: Record<string, unknown> = {};
    const recordMap = record as Record<string, unknown>;
    for (const [key, value] of Object.entries(select)) {
        if (value === true) {
            result[key] = recordMap[key];
            continue;
        }

        if (modelName === 'User' && key === 'posts' && isRecord(value)) {
            const relationArgs = value as QueryArgs;
            const posts = applyDistinct(
                sortRecords(
                    getUserPosts(store, record as UserRecord).filter((post) =>
                        recordMatches(store, 'Post', post, relationArgs.where)
                    ),
                    relationArgs.orderBy
                ),
                relationArgs.distinct
            )
                .slice(
                    relationArgs.skip ?? 0,
                    relationArgs.take ? (relationArgs.skip ?? 0) + relationArgs.take : undefined
                )
                .map((post) => applySelect(store, 'Post', post, relationArgs.select));
            result[key] = posts;
            continue;
        }

        if (modelName === 'Post' && key === 'author' && isRecord(value)) {
            const relationArgs = value as QueryArgs;
            const author = getPostAuthor(store, record as PostRecord);
            result[key] = author ? applySelect(store, 'User', author, relationArgs.select) : null;
        }
    }

    return result;
}

function computeAggregate<T extends Record<string, unknown>>(records: T[], args: QueryArgs) {
    const distinctRecords = applyDistinct(records, args.distinct);
    const response: Record<string, unknown> = {};

    if (args._count) {
        response._count = { _all: distinctRecords.length };
    }

    for (const aggregateKey of ['_avg', '_sum', '_min', '_max'] as const) {
        const fields = Object.keys(args[aggregateKey] ?? {});
        if (fields.length === 0) {
            continue;
        }

        response[aggregateKey] = Object.fromEntries(
            fields.map((field) => {
                const numericValues = distinctRecords
                    .map((record) => Number(record[field]))
                    .filter((value) => !Number.isNaN(value));
                if (numericValues.length === 0) {
                    return [field, null];
                }
                if (aggregateKey === '_avg') {
                    return [field, numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length];
                }
                if (aggregateKey === '_sum') {
                    return [field, numericValues.reduce((sum, value) => sum + value, 0)];
                }
                if (aggregateKey === '_min') {
                    return [field, numericValues.reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY)];
                }
                return [field, numericValues.reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY)];
            })
        );
    }

    return response;
}

function matchesUnique<T extends Record<string, unknown>>(record: T, where?: Record<string, unknown>) {
    return Object.entries(where ?? {}).every(([field, value]) => record[field] === value);
}

function createUserDelegate(store: DataStore) {
    return {
        async findMany(args: QueryArgs = {}) {
            return applyDistinct(
                sortRecords(
                    store.users.filter((record) => recordMatches(store, 'User', record, args.where)),
                    args.orderBy
                ),
                args.distinct
            )
                .slice(args.skip ?? 0, args.take ? (args.skip ?? 0) + args.take : undefined)
                .map((record) => applySelect(store, 'User', record, args.select));
        },
        async findUnique(args: QueryArgs = {}) {
            const entry = store.users.find((record) => matchesUnique(record, args.where));
            return entry ? applySelect(store, 'User', entry, args.select) : null;
        },
        async aggregate(args: QueryArgs = {}) {
            return computeAggregate(
                store.users.filter((record) => recordMatches(store, 'User', record, args.where)),
                args
            );
        },
        async create(args: QueryArgs = {}) {
            const data = isRecord(args.data) ? args.data : {};
            const record: UserRecord = {
                id: data.id === undefined ? nextId(store.users) : Number(data.id),
                name: String(data.name),
                age: Number(data.age),
                role: data.role === 'ADMIN' ? 'ADMIN' : 'USER',
            };
            store.users.push(record);

            const posts = isRecord(data.posts) && Array.isArray(data.posts.create) ? data.posts.create : [];
            for (const post of posts) {
                if (!isRecord(post)) {
                    continue;
                }
                store.posts.push({
                    id: post.id === undefined ? nextId(store.posts) : Number(post.id),
                    title: String(post.title),
                    authorId: record.id,
                    views: post.views === undefined ? 0 : Number(post.views),
                });
            }

            return applySelect(store, 'User', record, args.select);
        },
        async createMany(args: QueryArgs = {}) {
            const rows = Array.isArray(args.data) ? args.data : [];
            for (const row of rows) {
                if (!isRecord(row)) {
                    continue;
                }
                store.users.push({
                    id: row.id === undefined ? nextId(store.users) : Number(row.id),
                    name: String(row.name),
                    age: Number(row.age),
                    role: row.role === 'ADMIN' ? 'ADMIN' : 'USER',
                });
            }
            return { count: rows.length };
        },
        async createManyAndReturn(args: QueryArgs = {}) {
            const rows = Array.isArray(args.data) ? args.data : [];
            const created: Record<string, unknown>[] = [];
            for (const row of rows) {
                if (!isRecord(row)) {
                    continue;
                }
                const record: UserRecord = {
                    id: row.id === undefined ? nextId(store.users) : Number(row.id),
                    name: String(row.name),
                    age: Number(row.age),
                    role: row.role === 'ADMIN' ? 'ADMIN' : 'USER',
                };
                store.users.push(record);
                created.push(applySelect(store, 'User', record, args.select));
            }
            return created;
        },
        async upsert(args: QueryArgs = {}) {
            const where = isRecord(args.where) ? args.where : {};
            const existing = store.users.find((record) => matchesUnique(record, where));
            if (existing) {
                applyDataPatch(existing as Record<string, unknown>, isRecord(args.update) ? args.update : {});
                return applySelect(store, 'User', existing, args.select);
            }

            return this.create({
                data: isRecord(args.create) ? args.create : {},
                select: args.select,
            });
        },
        async update(args: QueryArgs = {}) {
            const entry = store.users.find((record) => matchesUnique(record, args.where));
            if (!entry) {
                return null;
            }
            const data = isRecord(args.data) ? args.data : {};
            const scalarData = Object.fromEntries(
                Object.entries(data).filter(([key]) => key !== 'posts')
            );
            applyDataPatch(entry as Record<string, unknown>, scalarData);

            if (isRecord(data.posts)) {
                if (Array.isArray(data.posts.create)) {
                    for (const row of data.posts.create) {
                        if (!isRecord(row)) {
                            continue;
                        }
                        store.posts.push({
                            id: row.id === undefined ? nextId(store.posts) : Number(row.id),
                            title: String(row.title),
                            authorId: entry.id,
                            views: row.views === undefined ? 0 : Number(row.views),
                        });
                    }
                }

                if (Array.isArray(data.posts.updateMany)) {
                    for (const patch of data.posts.updateMany) {
                        if (!isRecord(patch)) {
                            continue;
                        }
                        const rows = store.posts.filter(
                            (post) =>
                                post.authorId === entry.id &&
                                recordMatches(store, 'Post', post, patch.where as Record<string, unknown>)
                        );
                        for (const row of rows) {
                            applyDataPatch(
                                row as Record<string, unknown>,
                                isRecord(patch.data) ? patch.data : {}
                            );
                        }
                    }
                }
            }
            return applySelect(store, 'User', entry, args.select);
        },
        async updateMany(args: QueryArgs = {}) {
            const rows = store.users.filter((record) => recordMatches(store, 'User', record, args.where));
            for (const row of rows) {
                applyDataPatch(row as Record<string, unknown>, isRecord(args.data) ? args.data : {});
            }
            return { count: rows.length };
        },
        async delete(args: QueryArgs = {}) {
            const index = store.users.findIndex((record) => matchesUnique(record, args.where));
            if (index < 0) {
                return null;
            }
            const [removed] = store.users.splice(index, 1);
            return applySelect(store, 'User', removed, args.select);
        },
        async deleteMany(args: QueryArgs = {}) {
            const removed = store.users.filter((record) => recordMatches(store, 'User', record, args.where));
            store.users = store.users.filter((record) => !recordMatches(store, 'User', record, args.where));
            return { count: removed.length };
        },
    };
}

function createPostDelegate(store: DataStore) {
    return {
        async findMany(args: QueryArgs = {}) {
            return applyDistinct(
                sortRecords(
                    store.posts.filter((record) => recordMatches(store, 'Post', record, args.where)),
                    args.orderBy
                ),
                args.distinct
            )
                .slice(args.skip ?? 0, args.take ? (args.skip ?? 0) + args.take : undefined)
                .map((record) => applySelect(store, 'Post', record, args.select));
        },
        async findUnique(args: QueryArgs = {}) {
            const entry = store.posts.find((record) => matchesUnique(record, args.where));
            return entry ? applySelect(store, 'Post', entry, args.select) : null;
        },
        async aggregate(args: QueryArgs = {}) {
            return computeAggregate(
                store.posts.filter((record) => recordMatches(store, 'Post', record, args.where)),
                args
            );
        },
        async create(args: QueryArgs = {}) {
            const data = isRecord(args.data) ? args.data : {};
            let authorId = data.authorId === undefined ? undefined : Number(data.authorId);
            if (isRecord(data.author) && isRecord(data.author.create)) {
                const author = data.author.create;
                const createdAuthor: UserRecord = {
                    id: author.id === undefined ? nextId(store.users) : Number(author.id),
                    name: String(author.name),
                    age: Number(author.age),
                    role: author.role === 'ADMIN' ? 'ADMIN' : 'USER',
                };
                store.users.push(createdAuthor);
                authorId = createdAuthor.id;
            }
            const record: PostRecord = {
                id: data.id === undefined ? nextId(store.posts) : Number(data.id),
                title: String(data.title),
                authorId: Number(authorId),
                views: data.views === undefined ? 0 : Number(data.views),
            };
            store.posts.push(record);
            return applySelect(store, 'Post', record, args.select);
        },
        async createMany(args: QueryArgs = {}) {
            const rows = Array.isArray(args.data) ? args.data : [];
            for (const row of rows) {
                if (!isRecord(row)) {
                    continue;
                }
                store.posts.push({
                    id: row.id === undefined ? nextId(store.posts) : Number(row.id),
                    title: String(row.title),
                    authorId: Number(row.authorId),
                    views: row.views === undefined ? 0 : Number(row.views),
                });
            }
            return { count: rows.length };
        },
        async createManyAndReturn(args: QueryArgs = {}) {
            const rows = Array.isArray(args.data) ? args.data : [];
            const created: Record<string, unknown>[] = [];
            for (const row of rows) {
                if (!isRecord(row)) {
                    continue;
                }
                const record: PostRecord = {
                    id: row.id === undefined ? nextId(store.posts) : Number(row.id),
                    title: String(row.title),
                    authorId: Number(row.authorId),
                    views: row.views === undefined ? 0 : Number(row.views),
                };
                store.posts.push(record);
                created.push(applySelect(store, 'Post', record, args.select));
            }
            return created;
        },
        async upsert(args: QueryArgs = {}) {
            const where = isRecord(args.where) ? args.where : {};
            const existing = store.posts.find((record) => matchesUnique(record, where));
            if (existing) {
                applyDataPatch(existing as Record<string, unknown>, isRecord(args.update) ? args.update : {});
                return applySelect(store, 'Post', existing, args.select);
            }

            return this.create({
                data: isRecord(args.create) ? args.create : {},
                select: args.select,
            });
        },
        async update(args: QueryArgs = {}) {
            const entry = store.posts.find((record) => matchesUnique(record, args.where));
            if (!entry) {
                return null;
            }
            const data = isRecord(args.data) ? args.data : {};
            const scalarData = Object.fromEntries(
                Object.entries(data).filter(([key]) => key !== 'author')
            );
            applyDataPatch(entry as Record<string, unknown>, scalarData);

            if (isRecord(data.author)) {
                if (isRecord(data.author.create)) {
                    const author = data.author.create;
                    const createdAuthor: UserRecord = {
                        id: author.id === undefined ? nextId(store.users) : Number(author.id),
                        name: String(author.name),
                        age: Number(author.age),
                        role: author.role === 'ADMIN' ? 'ADMIN' : 'USER',
                    };
                    store.users.push(createdAuthor);
                    entry.authorId = createdAuthor.id;
                }

                if (isRecord(data.author.update)) {
                    const author = store.users.find((user) => user.id === entry.authorId);
                    if (author) {
                        applyDataPatch(
                            author as Record<string, unknown>,
                            data.author.update as Record<string, unknown>
                        );
                    }
                }
            }
            return applySelect(store, 'Post', entry, args.select);
        },
        async updateMany(args: QueryArgs = {}) {
            const rows = store.posts.filter((record) => recordMatches(store, 'Post', record, args.where));
            for (const row of rows) {
                applyDataPatch(row as Record<string, unknown>, isRecord(args.data) ? args.data : {});
            }
            return { count: rows.length };
        },
        async delete(args: QueryArgs = {}) {
            const index = store.posts.findIndex((record) => matchesUnique(record, args.where));
            if (index < 0) {
                return null;
            }
            const [removed] = store.posts.splice(index, 1);
            return applySelect(store, 'Post', removed, args.select);
        },
        async deleteMany(args: QueryArgs = {}) {
            const removed = store.posts.filter((record) => recordMatches(store, 'Post', record, args.where));
            store.posts = store.posts.filter((record) => !recordMatches(store, 'Post', record, args.where));
            return { count: removed.length };
        },
    };
}

export function createInMemoryClient(seed?: Partial<DataStore>) {
    const store = cloneStore(seed);
    const userDelegate = createUserDelegate(store);
    const postDelegate = createPostDelegate(store);

    const client: ZenStackClientLike = {
        User: userDelegate,
        user: userDelegate,
        Post: postDelegate,
        post: postDelegate,
    };

    return {
        client,
        store,
    };
}
