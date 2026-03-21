import type { GraphQLError, GraphQLScalarType, GraphQLResolveInfo } from 'graphql';

export type ScalarType =
    | 'ID'
    | 'String'
    | 'Int'
    | 'Float'
    | 'Boolean'
    | 'DateTime'
    | 'Decimal'
    | 'Json'
    | 'BigInt';

export type FieldKind = 'scalar' | 'enum' | 'relation';

export interface BaseFieldDefinition {
    name: string;
    kind: FieldKind;
    isList?: boolean;
    isNullable?: boolean;
    isId?: boolean;
    isUnique?: boolean;
    isReadOnly?: boolean;
    isComputed?: boolean;
    isInternal?: boolean;
    description?: string;
}

export interface ScalarFieldDefinition extends BaseFieldDefinition {
    kind: 'scalar';
    type: ScalarType;
}

export interface EnumFieldDefinition extends BaseFieldDefinition {
    kind: 'enum';
    type: string;
}

export interface RelationFieldDefinition extends BaseFieldDefinition {
    kind: 'relation';
    type: string;
    foreignKeyFields?: string[];
    referenceFields?: string[];
}

export type FieldDefinition =
    | ScalarFieldDefinition
    | EnumFieldDefinition
    | RelationFieldDefinition;

export interface UniqueConstraintDefinition {
    name?: string;
    fields: string[];
}

export interface ModelDefinition {
    name: string;
    dbName?: string;
    description?: string;
    fields: FieldDefinition[] | Record<string, FieldDefinition>;
    primaryKey?: string[];
    uniqueConstraints?: UniqueConstraintDefinition[];
}

export interface EnumDefinition {
    name: string;
    values: string[] | Record<string, string>;
    description?: string;
}

export interface ZenStackSchemaLike {
    provider?: {
        type?: string;
    };
    models?:
        | ModelDefinition[]
        | Record<string, ModelDefinition>
        | Record<string, { fields: ModelDefinition['fields']; primaryKey?: string[]; uniqueConstraints?: UniqueConstraintDefinition[] }>
        | Record<
              string,
              {
                  name?: string;
                  fields: Record<string, Record<string, unknown>>;
                  idFields?: readonly string[];
                  uniqueFields?: Record<string, unknown>;
              }
          >;
    enums?: EnumDefinition[] | Record<string, EnumDefinition>;
    modelMeta?: ZenStackSchemaLike['models'];
    enumMeta?: ZenStackSchemaLike['enums'];
}

export interface NormalizedEnumDefinition {
    name: string;
    values: string[];
    description?: string;
}

export interface NormalizedFieldDefinition extends BaseFieldDefinition {
    kind: FieldKind;
    type: string;
    foreignKeyFields?: string[];
    referenceFields?: string[];
}

export interface NormalizedModelDefinition {
    name: string;
    dbName?: string;
    description?: string;
    fields: NormalizedFieldDefinition[];
    fieldMap: Map<string, NormalizedFieldDefinition>;
    primaryKey: string[];
    uniqueConstraints: UniqueConstraintDefinition[];
}

export interface NormalizedSchema {
    provider?: {
        type?: string;
    };
    models: NormalizedModelDefinition[];
    modelMap: Map<string, NormalizedModelDefinition>;
    enums: NormalizedEnumDefinition[];
    enumMap: Map<string, NormalizedEnumDefinition>;
}

export type OrderByDirection =
    | 'asc'
    | 'desc'
    | 'asc_nulls_first'
    | 'asc_nulls_last'
    | 'desc_nulls_first'
    | 'desc_nulls_last';

export interface ResolverInvocation<TContext = unknown> {
    operation:
        | 'query'
        | 'aggregate'
        | 'insertMany'
        | 'insertOne'
        | 'updateMany'
        | 'updateByPk'
        | 'deleteMany'
        | 'deleteByPk'
        | 'relation';
    model: NormalizedModelDefinition;
    fieldName: string;
    args: Record<string, unknown>;
    context: TContext;
    info: GraphQLResolveInfo;
}

export interface ResolverHooks<TContext = unknown> {
    beforeResolve?: (invocation: ResolverInvocation<TContext>) => void | Promise<void>;
    afterResolve?: (
        result: unknown,
        invocation: ResolverInvocation<TContext>
    ) => void | Promise<void>;
    formatError?: (
        error: GraphQLError,
        invocation: ResolverInvocation<TContext>
    ) => GraphQLError | Promise<GraphQLError>;
}

export interface FeatureFlags {
    aggregates?: boolean;
    nestedArgs?: boolean;
    computedFields?: boolean;
    conflictClauses?: boolean;
    subscriptions?: boolean;
    exposeInternalFields?: boolean;
}

export interface NamingStrategy {
    queryMany(model: NormalizedModelDefinition): string;
    queryByPk(model: NormalizedModelDefinition): string;
    queryAggregate(model: NormalizedModelDefinition): string;
    insertMany(model: NormalizedModelDefinition): string;
    insertOne(model: NormalizedModelDefinition): string;
    updateMany(model: NormalizedModelDefinition): string;
    updateByPk(model: NormalizedModelDefinition): string;
    deleteMany(model: NormalizedModelDefinition): string;
    deleteByPk(model: NormalizedModelDefinition): string;
    typeName(modelName: string): string;
}

export type NamingConfig = 'hasura' | 'prisma' | Partial<NamingStrategy>;

export interface CreateZenStackGraphQLSchemaOptions<TClient = unknown, TContext = unknown> {
    schema: ZenStackSchemaLike | ModelDefinition[];
    getClient(context: TContext): TClient | Promise<TClient>;
    naming?: NamingConfig;
    features?: FeatureFlags;
    scalars?: Partial<Record<ScalarType, GraphQLScalarType>>;
    hooks?: ResolverHooks<TContext>;
}

export interface ModelDelegate {
    findMany?(args?: Record<string, unknown>): Promise<unknown[]>;
    findUnique?(args: Record<string, unknown>): Promise<unknown | null>;
    aggregate?(args?: Record<string, unknown>): Promise<Record<string, unknown>>;
    create?(args: Record<string, unknown>): Promise<unknown>;
    createMany?(args: Record<string, unknown>): Promise<{ count: number }>;
    createManyAndReturn?(args: Record<string, unknown>): Promise<unknown[]>;
    update?(args: Record<string, unknown>): Promise<unknown>;
    updateMany?(args: Record<string, unknown>): Promise<{ count: number }>;
    delete?(args: Record<string, unknown>): Promise<unknown>;
    deleteMany?(args: Record<string, unknown>): Promise<{ count: number }>;
}

export type ZenStackClientLike = Record<string, ModelDelegate | unknown> & {
    $transaction?<T>(operations: Promise<T>[]): Promise<T[]>;
};
