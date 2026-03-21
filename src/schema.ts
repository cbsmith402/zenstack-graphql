import {
    GraphQLEnumType,
    GraphQLInputObjectType,
    GraphQLInputType,
    GraphQLInt,
    GraphQLList,
    GraphQLNonNull,
    GraphQLObjectType,
    GraphQLOutputType,
    GraphQLSchema,
    GraphQLString,
    GraphQLFieldResolver,
    valueFromASTUntyped,
    type FieldNode,
    type GraphQLFieldConfig,
    type GraphQLFieldConfigMap,
    type GraphQLFieldConfigArgumentMap,
    type GraphQLInputFieldConfigMap,
    type GraphQLResolveInfo,
    type SelectionNode,
    type SelectionSetNode,
} from 'graphql';

import { normalizeError } from './errors.js';
import {
    getIdentifierFields,
    getScalarFields,
    isComparableScalar,
    isMutableField,
    isNumericScalar,
    normalizeSchema,
} from './metadata.js';
import { getScalarType, maybeWrapList } from './scalars.js';
import type {
    CreateZenStackGraphQLSchemaOptions,
    FeatureFlags,
    ModelDelegate,
    NamingConfig,
    NamingStrategy,
    NormalizedFieldDefinition,
    NormalizedModelDefinition,
    NormalizedSchema,
    OrderByDirection,
    ResolverInvocation,
    ScalarType,
    ZenStackClientLike,
} from './types.js';

const ORDER_BY_ENUM = new GraphQLEnumType({
    name: 'order_by',
    values: {
        asc: { value: 'asc' },
        desc: { value: 'desc' },
        asc_nulls_first: { value: 'asc_nulls_first' },
        asc_nulls_last: { value: 'asc_nulls_last' },
        desc_nulls_first: { value: 'desc_nulls_first' },
        desc_nulls_last: { value: 'desc_nulls_last' },
    },
});

const DEFAULT_FEATURES: Required<FeatureFlags> = {
    aggregates: true,
    nestedArgs: true,
    computedFields: false,
    conflictClauses: false,
    subscriptions: false,
    exposeInternalFields: false,
};

function lowerCamelCase(value: string) {
    return value.charAt(0).toLowerCase() + value.slice(1);
}

function pluralize(value: string) {
    if (value.endsWith('s')) {
        return value;
    }
    if (value.endsWith('y') && !/[aeiou]y$/i.test(value)) {
        return `${value.slice(0, -1)}ies`;
    }
    return `${value}s`;
}

function toHasuraCollectionName(model: NormalizedModelDefinition) {
    return pluralize(lowerCamelCase(model.dbName ?? model.name));
}

function resolveNamingStrategy(config?: NamingConfig): NamingStrategy {
    const defaults: NamingStrategy = {
        queryMany(model) {
            return toHasuraCollectionName(model);
        },
        queryByPk(model) {
            return `${toHasuraCollectionName(model)}_by_pk`;
        },
        queryAggregate(model) {
            return `${toHasuraCollectionName(model)}_aggregate`;
        },
        insertMany(model) {
            return `insert_${toHasuraCollectionName(model)}`;
        },
        insertOne(model) {
            return `insert_${toHasuraCollectionName(model)}_one`;
        },
        updateMany(model) {
            return `update_${toHasuraCollectionName(model)}`;
        },
        updateByPk(model) {
            return `update_${toHasuraCollectionName(model)}_by_pk`;
        },
        deleteMany(model) {
            return `delete_${toHasuraCollectionName(model)}`;
        },
        deleteByPk(model) {
            return `delete_${toHasuraCollectionName(model)}_by_pk`;
        },
        typeName(modelName) {
            return modelName;
        },
    };

    if (!config || config === 'hasura') {
        return defaults;
    }

    if (config === 'prisma') {
        return {
            ...defaults,
            queryMany(model) {
                return lowerCamelCase(model.name);
            },
            queryByPk(model) {
                return `${lowerCamelCase(model.name)}ByPk`;
            },
            queryAggregate(model) {
                return `${lowerCamelCase(model.name)}Aggregate`;
            },
            insertMany(model) {
                return `create${pluralize(model.name)}`;
            },
            insertOne(model) {
                return `create${model.name}`;
            },
            updateMany(model) {
                return `update${pluralize(model.name)}`;
            },
            updateByPk(model) {
                return `update${model.name}ByPk`;
            },
            deleteMany(model) {
                return `delete${pluralize(model.name)}`;
            },
            deleteByPk(model) {
                return `delete${model.name}ByPk`;
            },
        };
    }

    return { ...defaults, ...config };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOrderDirection(direction: OrderByDirection) {
    return direction.startsWith('desc') ? 'desc' : 'asc';
}

function mergeInsensitive(
    target: Record<string, unknown>,
    key: string,
    value: unknown,
    insensitive = false
) {
    target[key] = value;
    if (insensitive) {
        target.mode = 'insensitive';
    }
}

function likePatternToFilter(pattern: string, insensitive = false) {
    const startsWithPercent = pattern.startsWith('%');
    const endsWithPercent = pattern.endsWith('%');
    const core = pattern.replace(/^%/, '').replace(/%$/, '');
    const filter: Record<string, unknown> = {};

    if (startsWithPercent && endsWithPercent) {
        mergeInsensitive(filter, 'contains', core, insensitive);
        return filter;
    }
    if (startsWithPercent) {
        mergeInsensitive(filter, 'endsWith', core, insensitive);
        return filter;
    }
    if (endsWithPercent) {
        mergeInsensitive(filter, 'startsWith', core, insensitive);
        return filter;
    }

    mergeInsensitive(filter, 'equals', core, insensitive);
    return filter;
}

class SchemaBuilder<TClient extends ZenStackClientLike, TContext> {
    private readonly normalizedSchema: NormalizedSchema;
    private readonly features: Required<FeatureFlags>;
    private readonly naming: NamingStrategy;
    private readonly objectTypes = new Map<string, GraphQLObjectType>();
    private readonly enumTypes = new Map<string, GraphQLEnumType>();
    private readonly comparisonInputs = new Map<string, GraphQLInputObjectType>();
    private readonly whereInputs = new Map<string, GraphQLInputObjectType>();
    private readonly orderInputs = new Map<string, GraphQLInputObjectType>();
    private readonly insertInputs = new Map<string, GraphQLInputObjectType>();
    private readonly setInputs = new Map<string, GraphQLInputObjectType>();
    private readonly incInputs = new Map<string, GraphQLInputObjectType>();
    private readonly mutationResponseTypes = new Map<string, GraphQLObjectType>();
    private readonly aggregateTypes = new Map<string, GraphQLObjectType>();
    private readonly aggregateFieldsTypes = new Map<string, GraphQLObjectType>();
    private readonly aggregateLeafTypes = new Map<string, GraphQLObjectType>();

    constructor(private readonly options: CreateZenStackGraphQLSchemaOptions<TClient, TContext>) {
        this.normalizedSchema = normalizeSchema(options.schema);
        this.features = { ...DEFAULT_FEATURES, ...options.features };
        this.naming = resolveNamingStrategy(options.naming);
    }

    createSchema() {
        const queryFields: GraphQLFieldConfigMap<unknown, TContext> = {};
        const mutationFields: GraphQLFieldConfigMap<unknown, TContext> = {};

        for (const model of this.normalizedSchema.models) {
            queryFields[this.naming.queryMany(model)] = {
                type: new GraphQLNonNull(new GraphQLList(this.getModelObjectType(model))),
                description: `List ${model.name} records`,
                args: {
                    where: { type: this.getWhereInput(model) },
                    order_by: { type: new GraphQLList(this.getOrderByInput(model)) },
                    limit: { type: GraphQLInt },
                    offset: { type: GraphQLInt },
                },
                resolve: this.createResolver('query', model, async ({ client, args, info }) => {
                    const delegate = this.getRequiredDelegate(client, model);
                    const queryArgs = this.compileFindManyArgs(model, args, info);
                    this.assertMethod(delegate, 'findMany', model);
                    return delegate.findMany!(queryArgs);
                }),
            };

            if (getIdentifierFields(model).length > 0) {
                queryFields[this.naming.queryByPk(model)] = {
                    type: this.getModelObjectType(model),
                    description: `Fetch ${model.name} by primary key`,
                    args: this.getPrimaryKeyArgs(model),
                    resolve: this.createResolver('query', model, async ({ client, args, info }) => {
                        const delegate = this.getRequiredDelegate(client, model);
                        if (delegate.findUnique) {
                            return delegate.findUnique({
                                where: this.buildUniqueWhere(model, args),
                                select: this.buildSelection(model, info.fieldNodes, info),
                            });
                        }
                        this.assertMethod(delegate, 'findMany', model);
                        const rows = await delegate.findMany!({
                            where: this.buildUniqueWhere(model, args),
                            take: 1,
                            select: this.buildSelection(model, info.fieldNodes, info),
                        });
                        return rows[0] ?? null;
                    }),
                };
            }

            if (this.features.aggregates) {
                queryFields[this.naming.queryAggregate(model)] = {
                    type: new GraphQLNonNull(this.getAggregateType(model)),
                    description: `Aggregate ${model.name} records`,
                    args: {
                        where: { type: this.getWhereInput(model) },
                        order_by: { type: new GraphQLList(this.getOrderByInput(model)) },
                        limit: { type: GraphQLInt },
                        offset: { type: GraphQLInt },
                    },
                    resolve: this.createResolver(
                        'aggregate',
                        model,
                        async ({ client, args, info }) => this.resolveAggregate(model, client, args, info)
                    ),
                };
            }

            mutationFields[this.naming.insertMany(model)] = {
                type: new GraphQLNonNull(this.getMutationResponseType(model)),
                args: {
                    objects: {
                        type: new GraphQLNonNull(
                            new GraphQLList(new GraphQLNonNull(this.getInsertInput(model)))
                        ),
                    },
                },
                resolve: this.createResolver(
                    'insertMany',
                    model,
                    async ({ client, args, info }) => this.resolveInsertMany(model, client, args, info)
                ),
            };

            mutationFields[this.naming.insertOne(model)] = {
                type: this.getModelObjectType(model),
                args: {
                    object: { type: new GraphQLNonNull(this.getInsertInput(model)) },
                },
                resolve: this.createResolver('insertOne', model, async ({ client, args, info }) => {
                    const delegate = this.getRequiredDelegate(client, model);
                    this.assertMethod(delegate, 'create', model);
                    return delegate.create!({
                        data: args.object,
                        select: this.buildSelection(model, info.fieldNodes, info),
                    });
                }),
            };

            mutationFields[this.naming.updateMany(model)] = {
                type: new GraphQLNonNull(this.getMutationResponseType(model)),
                args: {
                    where: { type: new GraphQLNonNull(this.getWhereInput(model)) },
                    _set: { type: this.getSetInput(model) },
                    _inc: { type: this.getIncInput(model) },
                },
                resolve: this.createResolver(
                    'updateMany',
                    model,
                    async ({ client, args, info }) => this.resolveUpdateMany(model, client, args, info)
                ),
            };

            if (getIdentifierFields(model).length > 0) {
                mutationFields[this.naming.updateByPk(model)] = {
                    type: this.getModelObjectType(model),
                    args: {
                        ...this.getPrimaryKeyArgs(model),
                        _set: { type: this.getSetInput(model) },
                        _inc: { type: this.getIncInput(model) },
                    },
                    resolve: this.createResolver(
                        'updateByPk',
                        model,
                        async ({ client, args, info }) => this.resolveUpdateByPk(model, client, args, info)
                    ),
                };

                mutationFields[this.naming.deleteByPk(model)] = {
                    type: this.getModelObjectType(model),
                    args: this.getPrimaryKeyArgs(model),
                    resolve: this.createResolver(
                        'deleteByPk',
                        model,
                        async ({ client, args, info }) => this.resolveDeleteByPk(model, client, args, info)
                    ),
                };
            }

            mutationFields[this.naming.deleteMany(model)] = {
                type: new GraphQLNonNull(this.getMutationResponseType(model)),
                args: {
                    where: { type: new GraphQLNonNull(this.getWhereInput(model)) },
                },
                resolve: this.createResolver(
                    'deleteMany',
                    model,
                    async ({ client, args, info }) => this.resolveDeleteMany(model, client, args, info)
                ),
            };
        }

        return new GraphQLSchema({
            query: new GraphQLObjectType({
                name: 'Query',
                fields: () => queryFields,
            }),
            mutation: new GraphQLObjectType({
                name: 'Mutation',
                fields: () => mutationFields,
            }),
        });
    }

    private getModel(modelName: string) {
        const model = this.normalizedSchema.modelMap.get(modelName);
        if (!model) {
            throw new Error(`Unknown model "${modelName}"`);
        }
        return model;
    }

    private getVisibleFields(model: NormalizedModelDefinition) {
        return model.fields.filter((field) => {
            if (!this.features.exposeInternalFields && field.isInternal) {
                return false;
            }
            if (!this.features.computedFields && field.isComputed) {
                return false;
            }
            return true;
        });
    }

    private getMutableFields(model: NormalizedModelDefinition) {
        return this.getVisibleFields(model).filter((field) =>
            isMutableField(field, this.features.exposeInternalFields)
        );
    }

    private getEnumType(name: string) {
        const existing = this.enumTypes.get(name);
        if (existing) {
            return existing;
        }

        const enumDefinition = this.normalizedSchema.enumMap.get(name);
        if (!enumDefinition) {
            throw new Error(`Unknown enum "${name}"`);
        }

        const enumType = new GraphQLEnumType({
            name,
            description: enumDefinition.description,
            values: Object.fromEntries(
                enumDefinition.values.map((value) => [value, { value }])
            ),
        });
        this.enumTypes.set(name, enumType);
        return enumType;
    }

    private getFieldOutputType(field: NormalizedFieldDefinition): GraphQLOutputType {
        if (field.kind === 'relation') {
            const relatedModel = this.getModel(field.type);
            return maybeWrapList(
                this.getModelObjectType(relatedModel),
                field.isList,
                field.isNullable
            ) as GraphQLOutputType;
        }

        if (field.kind === 'enum') {
            return maybeWrapList(
                this.getEnumType(field.type),
                field.isList,
                field.isNullable
            ) as GraphQLOutputType;
        }

        return maybeWrapList(
            getScalarType(field.type as ScalarType, this.options.scalars),
            field.isList,
            field.isNullable
        ) as GraphQLOutputType;
    }

    private getComparatorInput(field: NormalizedFieldDefinition) {
        const key = `${field.kind}:${field.type}`;
        const existing = this.comparisonInputs.get(key);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: `${field.type}_comparison_exp`,
            fields: () => {
                const baseType =
                    field.kind === 'enum'
                        ? this.getEnumType(field.type)
                        : getScalarType(field.type as ScalarType, this.options.scalars);
                const fields: GraphQLInputFieldConfigMap = {
                    _eq: { type: baseType },
                    _neq: { type: baseType },
                    _in: { type: new GraphQLList(new GraphQLNonNull(baseType)) },
                    _nin: { type: new GraphQLList(new GraphQLNonNull(baseType)) },
                    _is_null: { type: getScalarType('Boolean', this.options.scalars) },
                };

                if (field.kind === 'scalar' && isComparableScalar(field.type)) {
                    fields._gt = { type: baseType };
                    fields._gte = { type: baseType };
                    fields._lt = { type: baseType };
                    fields._lte = { type: baseType };
                }

                if (field.kind === 'scalar' && field.type === 'String') {
                    fields._contains = { type: GraphQLString };
                    fields._icontains = { type: GraphQLString };
                    fields._starts_with = { type: GraphQLString };
                    fields._istarts_with = { type: GraphQLString };
                    fields._ends_with = { type: GraphQLString };
                    fields._iends_with = { type: GraphQLString };
                    fields._like = { type: GraphQLString };
                    fields._ilike = { type: GraphQLString };
                }

                return fields;
            },
        });

        this.comparisonInputs.set(key, input);
        return input;
    }

    private getWhereInput(model: NormalizedModelDefinition) {
        const existing = this.whereInputs.get(model.name);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: `${this.naming.typeName(model.name)}_bool_exp`,
            fields: () => {
                const fields: GraphQLInputFieldConfigMap = {
                    _and: { type: new GraphQLList(new GraphQLNonNull(input)) },
                    _or: { type: new GraphQLList(new GraphQLNonNull(input)) },
                    _not: { type: input },
                };

                for (const field of this.getVisibleFields(model)) {
                    if (field.kind === 'relation') {
                        fields[field.name] = { type: this.getWhereInput(this.getModel(field.type)) };
                    } else {
                        fields[field.name] = { type: this.getComparatorInput(field) };
                    }
                }

                return fields;
            },
        });

        this.whereInputs.set(model.name, input);
        return input;
    }

    private getOrderByInput(model: NormalizedModelDefinition) {
        const existing = this.orderInputs.get(model.name);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: `${this.naming.typeName(model.name)}_order_by`,
            fields: () => {
                const fields: GraphQLInputFieldConfigMap = {};
                for (const field of this.getVisibleFields(model)) {
                    if (field.kind === 'relation') {
                        fields[field.name] = { type: this.getOrderByInput(this.getModel(field.type)) };
                    } else {
                        fields[field.name] = { type: ORDER_BY_ENUM };
                    }
                }
                return fields;
            },
        });

        this.orderInputs.set(model.name, input);
        return input;
    }

    private getInsertInput(model: NormalizedModelDefinition) {
        const existing = this.insertInputs.get(model.name);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: `${this.naming.typeName(model.name)}_insert_input`,
            fields: () => this.getMutableInputFields(model),
        });

        this.insertInputs.set(model.name, input);
        return input;
    }

    private getSetInput(model: NormalizedModelDefinition) {
        const existing = this.setInputs.get(model.name);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: `${this.naming.typeName(model.name)}_set_input`,
            fields: () => this.getMutableInputFields(model),
        });

        this.setInputs.set(model.name, input);
        return input;
    }

    private getIncInput(model: NormalizedModelDefinition) {
        const existing = this.incInputs.get(model.name);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: `${this.naming.typeName(model.name)}_inc_input`,
            fields: () => {
                const fields: GraphQLInputFieldConfigMap = {};
                for (const field of this.getMutableFields(model)) {
                    if (field.kind === 'scalar' && isNumericScalar(field.type)) {
                        fields[field.name] = {
                            type: getScalarType(field.type as ScalarType, this.options.scalars),
                        };
                    }
                }
                return fields;
            },
        });

        this.incInputs.set(model.name, input);
        return input;
    }

    private getMutableInputFields(model: NormalizedModelDefinition) {
        const fields: GraphQLInputFieldConfigMap = {};
        for (const field of this.getMutableFields(model)) {
            const outputType =
                field.kind === 'enum'
                    ? this.getEnumType(field.type)
                    : getScalarType(field.type as ScalarType, this.options.scalars);

            fields[field.name] = {
                type: maybeWrapList(outputType as GraphQLInputType, field.isList, true) as GraphQLInputType,
                description: field.description,
            };
        }
        return fields;
    }

    private getPrimaryKeyArgs(model: NormalizedModelDefinition): GraphQLFieldConfigArgumentMap {
        const args: GraphQLFieldConfigArgumentMap = {};
        for (const fieldName of getIdentifierFields(model)) {
            const field = model.fieldMap.get(fieldName);
            if (!field) {
                continue;
            }
            const baseType =
                field.kind === 'enum'
                    ? this.getEnumType(field.type)
                    : getScalarType(field.type as ScalarType, this.options.scalars);
            args[fieldName] = {
                type: new GraphQLNonNull(baseType),
            };
        }
        return args;
    }

    private getModelObjectType(model: NormalizedModelDefinition) {
        const existing = this.objectTypes.get(model.name);
        if (existing) {
            return existing;
        }

        const objectType = new GraphQLObjectType({
            name: this.naming.typeName(model.name),
            description: model.description,
            fields: () => {
                const fields: GraphQLFieldConfigMap<Record<string, unknown>, TContext> = {};
                for (const field of this.getVisibleFields(model)) {
                    const config: GraphQLFieldConfig<Record<string, unknown>, TContext> = {
                        type: this.getFieldOutputType(field),
                        description: field.description,
                    };

                    if (field.kind === 'relation') {
                        const relatedModel = this.getModel(field.type);
                        if (this.features.nestedArgs && field.isList) {
                            config.args = {
                                where: { type: this.getWhereInput(relatedModel) },
                                order_by: { type: new GraphQLList(this.getOrderByInput(relatedModel)) },
                                limit: { type: GraphQLInt },
                                offset: { type: GraphQLInt },
                            };
                        }
                        config.resolve = this.createRelationResolver(model, field);
                    }

                    fields[field.name] = config;
                }
                return fields;
            },
        });

        this.objectTypes.set(model.name, objectType);
        return objectType;
    }

    private getMutationResponseType(model: NormalizedModelDefinition) {
        const existing = this.mutationResponseTypes.get(model.name);
        if (existing) {
            return existing;
        }

        const responseType = new GraphQLObjectType({
            name: `${this.naming.typeName(model.name)}_mutation_response`,
            fields: () => ({
                affected_rows: {
                    type: new GraphQLNonNull(GraphQLInt),
                },
                returning: {
                    type: new GraphQLNonNull(
                        new GraphQLList(new GraphQLNonNull(this.getModelObjectType(model)))
                    ),
                },
            }),
        });

        this.mutationResponseTypes.set(model.name, responseType);
        return responseType;
    }

    private getAggregateLeafType(
        model: NormalizedModelDefinition,
        suffix: 'avg' | 'sum' | 'min' | 'max'
    ) {
        const key = `${model.name}:${suffix}`;
        const existing = this.aggregateLeafTypes.get(key);
        if (existing) {
            return existing;
        }

        const leafType = new GraphQLObjectType({
            name: `${this.naming.typeName(model.name)}_${suffix}_fields`,
            fields: () => {
                const fields: GraphQLFieldConfigMap<unknown, TContext> = {};
                for (const field of getScalarFields(model)) {
                    if (field.kind !== 'scalar') {
                        continue;
                    }

                    if (suffix === 'avg' || suffix === 'sum') {
                        if (!isNumericScalar(field.type)) {
                            continue;
                        }
                    }

                    if ((suffix === 'min' || suffix === 'max') && !isComparableScalar(field.type)) {
                        continue;
                    }

                    fields[field.name] = {
                        type: getScalarType(field.type as ScalarType, this.options.scalars),
                    };
                }
                return fields;
            },
        });

        this.aggregateLeafTypes.set(key, leafType);
        return leafType;
    }

    private getAggregateFieldsType(model: NormalizedModelDefinition) {
        const existing = this.aggregateFieldsTypes.get(model.name);
        if (existing) {
            return existing;
        }

        const aggregateFieldsType = new GraphQLObjectType({
            name: `${this.naming.typeName(model.name)}_aggregate_fields`,
            fields: () => ({
                count: {
                    type: new GraphQLNonNull(GraphQLInt),
                },
                avg: {
                    type: this.getAggregateLeafType(model, 'avg'),
                },
                sum: {
                    type: this.getAggregateLeafType(model, 'sum'),
                },
                min: {
                    type: this.getAggregateLeafType(model, 'min'),
                },
                max: {
                    type: this.getAggregateLeafType(model, 'max'),
                },
            }),
        });

        this.aggregateFieldsTypes.set(model.name, aggregateFieldsType);
        return aggregateFieldsType;
    }

    private getAggregateType(model: NormalizedModelDefinition) {
        const existing = this.aggregateTypes.get(model.name);
        if (existing) {
            return existing;
        }

        const aggregateType = new GraphQLObjectType({
            name: `${this.naming.typeName(model.name)}_aggregate`,
            fields: () => ({
                aggregate: {
                    type: this.getAggregateFieldsType(model),
                },
                nodes: {
                    type: new GraphQLNonNull(
                        new GraphQLList(new GraphQLNonNull(this.getModelObjectType(model)))
                    ),
                },
            }),
        });

        this.aggregateTypes.set(model.name, aggregateType);
        return aggregateType;
    }

    private createResolver<TArgs extends Record<string, unknown>, TResult>(
        operation: ResolverInvocation<TContext>['operation'],
        model: NormalizedModelDefinition,
        handler: (input: {
            client: TClient;
            args: TArgs;
            context: TContext;
            info: GraphQLResolveInfo;
        }) => Promise<TResult>
    ): GraphQLFieldResolver<unknown, TContext, TArgs> {
        return async (_source, args, context, info) => {
            const invocation: ResolverInvocation<TContext> = {
                operation,
                model,
                fieldName: info.fieldName,
                args,
                context,
                info,
            };

            await this.options.hooks?.beforeResolve?.(invocation);

            try {
                const client = (await this.options.getClient(context)) as TClient;
                const result = await handler({ client, args, context, info });
                await this.options.hooks?.afterResolve?.(result, invocation);
                return result;
            } catch (error) {
                const normalized = normalizeError(error);
                const formatted =
                    (await this.options.hooks?.formatError?.(normalized, invocation)) ?? normalized;
                throw formatted;
            }
        };
    }

    private createRelationResolver(
        model: NormalizedModelDefinition,
        relationField: NormalizedFieldDefinition
    ): GraphQLFieldResolver<Record<string, unknown>, TContext, Record<string, unknown>> {
        const relatedModel = this.getModel(relationField.type);
        return async (source, args, context, info) => {
            if (source[relationField.name] !== undefined) {
                return source[relationField.name];
            }

            const parentWhere = this.buildUniqueWhereFromRecord(model, source);
            if (!parentWhere) {
                return relationField.isList ? [] : null;
            }

            const client = (await this.options.getClient(context)) as TClient;
            const delegate = this.getRequiredDelegate(client, model);
            if (!delegate.findUnique) {
                return relationField.isList ? [] : null;
            }

            const relationSelect =
                relationField.isList && this.features.nestedArgs
                    ? {
                          where: this.toWhere(relatedModel, args.where),
                          orderBy: this.toOrderBy(relatedModel, args.order_by),
                          take: typeof args.limit === 'number' ? args.limit : undefined,
                          skip: typeof args.offset === 'number' ? args.offset : undefined,
                          select: this.buildSelection(relatedModel, info.fieldNodes, info),
                      }
                    : {
                          select: this.buildSelection(relatedModel, info.fieldNodes, info),
                      };

            const result = (await delegate.findUnique({
                where: parentWhere,
                select: {
                    [relationField.name]: relationSelect,
                },
            })) as Record<string, unknown> | null;

            return result?.[relationField.name] ?? (relationField.isList ? [] : null);
        };
    }

    private getRequiredDelegate(client: TClient, model: NormalizedModelDefinition) {
        const candidates = [
            model.name,
            lowerCamelCase(model.name),
            toHasuraCollectionName(model),
        ];

        for (const key of candidates) {
            const value = (client as Record<string, unknown>)[key];
            if (value) {
                return value as ModelDelegate;
            }
        }

        throw new Error(`Unable to locate a delegate for model "${model.name}" on the ZenStack client`);
    }

    private assertMethod(
        delegate: ModelDelegate,
        method: keyof ModelDelegate,
        model: NormalizedModelDefinition
    ) {
        if (typeof delegate[method] !== 'function') {
            throw new Error(`Delegate for model "${model.name}" does not implement "${String(method)}"`);
        }
    }

    private compileFindManyArgs(
        model: NormalizedModelDefinition,
        args: Record<string, unknown>,
        info: GraphQLResolveInfo
    ) {
        return {
            where: this.toWhere(model, args.where),
            orderBy: this.toOrderBy(model, args.order_by),
            take: typeof args.limit === 'number' ? args.limit : undefined,
            skip: typeof args.offset === 'number' ? args.offset : undefined,
            select: this.buildSelection(model, info.fieldNodes, info),
        };
    }

    private buildSelection(
        model: NormalizedModelDefinition,
        fieldNodes: readonly FieldNode[],
        info: Pick<GraphQLResolveInfo, 'fragments' | 'variableValues'>
    ): Record<string, unknown> {
        const selections = this.collectFields(fieldNodes, info);
        return this.buildSelectionFromFields(model, selections, info);
    }

    private buildSelectionFromFields(
        model: NormalizedModelDefinition,
        fieldNodes: FieldNode[],
        info: Pick<GraphQLResolveInfo, 'fragments' | 'variableValues'>
    ): Record<string, unknown> {
        const select: Record<string, unknown> = {};
        for (const fieldNode of fieldNodes) {
            const fieldName = fieldNode.name.value;
            if (fieldName === '__typename') {
                continue;
            }

            const field = model.fieldMap.get(fieldName);
            if (!field) {
                continue;
            }

            if (field.kind !== 'relation') {
                select[fieldName] = true;
                continue;
            }

            const relatedModel = this.getModel(field.type);
            const nestedFields = this.collectSelectionNodes(fieldNode.selectionSet, info).filter(
                (node): node is FieldNode => node.kind === 'Field'
            );
            const nestedSelect = this.buildSelectionFromFields(relatedModel, nestedFields, info);
            if (field.isList) {
                const relationArgs = this.argumentsFromFieldNode(fieldNode, info);
                select[fieldName] = {
                    where: this.toWhere(relatedModel, relationArgs.where),
                    orderBy: this.toOrderBy(relatedModel, relationArgs.order_by),
                    take: typeof relationArgs.limit === 'number' ? relationArgs.limit : undefined,
                    skip: typeof relationArgs.offset === 'number' ? relationArgs.offset : undefined,
                    select: nestedSelect,
                };
            } else {
                select[fieldName] = {
                    select: nestedSelect,
                };
            }
        }

        return select;
    }

    private collectFields(
        fieldNodes: readonly FieldNode[],
        info: Pick<GraphQLResolveInfo, 'fragments' | 'variableValues'>
    ) {
        const collected: FieldNode[] = [];
        for (const fieldNode of fieldNodes) {
            if (!fieldNode.selectionSet) {
                continue;
            }
            collected.push(
                ...this.collectSelectionNodes(fieldNode.selectionSet, info).filter(
                    (node): node is FieldNode => node.kind === 'Field'
                )
            );
        }
        return collected;
    }

    private collectSelectionNodes(
        selectionSet: SelectionSetNode | undefined,
        info: Pick<GraphQLResolveInfo, 'fragments' | 'variableValues'>
    ): SelectionNode[] {
        if (!selectionSet) {
            return [];
        }

        const nodes: SelectionNode[] = [];
        for (const selection of selectionSet.selections) {
            if (selection.kind === 'Field') {
                nodes.push(selection);
                continue;
            }

            if (selection.kind === 'InlineFragment') {
                nodes.push(...this.collectSelectionNodes(selection.selectionSet, info));
                continue;
            }

            const fragment = info.fragments[selection.name.value];
            if (fragment) {
                nodes.push(...this.collectSelectionNodes(fragment.selectionSet, info));
            }
        }

        return nodes;
    }

    private argumentsFromFieldNode(
        fieldNode: FieldNode,
        info: Pick<GraphQLResolveInfo, 'variableValues'>
    ) {
        const args: Record<string, unknown> = {};
        for (const arg of fieldNode.arguments ?? []) {
            args[arg.name.value] = valueFromASTUntyped(arg.value, info.variableValues);
        }
        return args;
    }

    private toWhere(model: NormalizedModelDefinition, input: unknown): Record<string, unknown> | undefined {
        if (!isPlainObject(input)) {
            return undefined;
        }

        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(input)) {
            if (value === undefined) {
                continue;
            }

            if (key === '_and' && Array.isArray(value)) {
                result.AND = value
                    .map((entry) => this.toWhere(model, entry))
                    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
                continue;
            }

            if (key === '_or' && Array.isArray(value)) {
                result.OR = value
                    .map((entry) => this.toWhere(model, entry))
                    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
                continue;
            }

            if (key === '_not') {
                result.NOT = this.toWhere(model, value);
                continue;
            }

            const field = model.fieldMap.get(key);
            if (!field) {
                continue;
            }

            if (field.kind === 'relation') {
                const relatedWhere = this.toWhere(this.getModel(field.type), value);
                if (!relatedWhere) {
                    continue;
                }
                result[key] = field.isList ? { some: relatedWhere } : { is: relatedWhere };
                continue;
            }

            result[key] = this.toScalarWhere(field, value);
        }

        return Object.keys(result).length > 0 ? result : undefined;
    }

    private toScalarWhere(field: NormalizedFieldDefinition, input: unknown) {
        if (!isPlainObject(input)) {
            return input;
        }

        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(input)) {
            switch (key) {
                case '_eq':
                    result.equals = value;
                    break;
                case '_neq':
                    result.not = value;
                    break;
                case '_gt':
                    result.gt = value;
                    break;
                case '_gte':
                    result.gte = value;
                    break;
                case '_lt':
                    result.lt = value;
                    break;
                case '_lte':
                    result.lte = value;
                    break;
                case '_in':
                    result.in = value;
                    break;
                case '_nin':
                    result.notIn = value;
                    break;
                case '_is_null':
                    if (value === true) {
                        result.equals = null;
                    } else if (value === false) {
                        result.not = null;
                    }
                    break;
                case '_contains':
                    result.contains = value;
                    break;
                case '_icontains':
                    result.contains = value;
                    result.mode = 'insensitive';
                    break;
                case '_starts_with':
                    result.startsWith = value;
                    break;
                case '_istarts_with':
                    result.startsWith = value;
                    result.mode = 'insensitive';
                    break;
                case '_ends_with':
                    result.endsWith = value;
                    break;
                case '_iends_with':
                    result.endsWith = value;
                    result.mode = 'insensitive';
                    break;
                case '_like':
                    Object.assign(result, likePatternToFilter(String(value)));
                    break;
                case '_ilike':
                    Object.assign(result, likePatternToFilter(String(value), true));
                    break;
                default:
                    if (field.kind === 'enum') {
                        result[key] = value;
                    }
                    break;
            }
        }
        return result;
    }

    private toOrderBy(model: NormalizedModelDefinition, input: unknown) {
        if (!input) {
            return undefined;
        }

        const values = Array.isArray(input) ? input : [input];
        const result = values
            .map((entry) => this.toSingleOrderBy(model, entry))
            .filter((entry): entry is Record<string, unknown> => Boolean(entry));
        if (result.length === 0) {
            return undefined;
        }
        return result.length === 1 ? result[0] : result;
    }

    private toSingleOrderBy(model: NormalizedModelDefinition, input: unknown) {
        if (!isPlainObject(input)) {
            return undefined;
        }

        const orderBy: Record<string, unknown> = {};
        for (const [fieldName, value] of Object.entries(input)) {
            const field = model.fieldMap.get(fieldName);
            if (!field) {
                continue;
            }

            if (field.kind === 'relation') {
                const nested = this.toSingleOrderBy(this.getModel(field.type), value);
                if (nested) {
                    orderBy[fieldName] = nested;
                }
                continue;
            }

            if (typeof value === 'string') {
                orderBy[fieldName] = normalizeOrderDirection(value as OrderByDirection);
            }
        }

        return Object.keys(orderBy).length > 0 ? orderBy : undefined;
    }

    private buildUniqueWhere(model: NormalizedModelDefinition, args: Record<string, unknown>) {
        const fields = getIdentifierFields(model);
        return Object.fromEntries(fields.map((fieldName) => [fieldName, args[fieldName]]));
    }

    private buildUniqueWhereFromRecord(
        model: NormalizedModelDefinition,
        record: Record<string, unknown>
    ) {
        const fields = getIdentifierFields(model);
        if (fields.length === 0) {
            return undefined;
        }

        const values = fields.map((field) => record[field]);
        if (values.some((value) => value === undefined)) {
            return undefined;
        }

        return Object.fromEntries(fields.map((field) => [field, record[field]]));
    }

    private buildMutationData(args: Record<string, unknown>) {
        const data: Record<string, unknown> = {};
        if (isPlainObject(args._set)) {
            Object.assign(data, args._set);
        }

        if (isPlainObject(args._inc)) {
            for (const [field, value] of Object.entries(args._inc)) {
                data[field] = { increment: value };
            }
        }

        if (Object.keys(data).length === 0) {
            throw new Error('At least one of "_set" or "_inc" must be provided');
        }

        return data;
    }

    private getReturningSelection(
        model: NormalizedModelDefinition,
        info: GraphQLResolveInfo
    ): Record<string, unknown> | undefined {
        const returningField = this.collectFields(info.fieldNodes, info).find(
            (field) => field.name.value === 'returning'
        );
        if (!returningField?.selectionSet) {
            return undefined;
        }

        const fields = this.collectSelectionNodes(returningField.selectionSet, info).filter(
            (node): node is FieldNode => node.kind === 'Field'
        );
        return this.buildSelectionFromFields(model, fields, info);
    }

    private getAggregatePlan(model: NormalizedModelDefinition, info: GraphQLResolveInfo) {
        const aggregateField = this.collectFields(info.fieldNodes, info).find(
            (field) => field.name.value === 'aggregate'
        );
        const nodesField = this.collectFields(info.fieldNodes, info).find(
            (field) => field.name.value === 'nodes'
        );

        const plan = {
            wantsAggregate: Boolean(aggregateField),
            wantsNodes: Boolean(nodesField),
            aggregate: {
                count: false,
                avg: [] as string[],
                sum: [] as string[],
                min: [] as string[],
                max: [] as string[],
            },
            nodeSelection: undefined as Record<string, unknown> | undefined,
        };

        if (aggregateField?.selectionSet) {
            const innerAggregate = this.collectSelectionNodes(aggregateField.selectionSet, info).filter(
                (node): node is FieldNode => node.kind === 'Field'
            );
            for (const node of innerAggregate) {
                const name = node.name.value;
                if (name === 'count') {
                    plan.aggregate.count = true;
                    continue;
                }

                if (!node.selectionSet) {
                    continue;
                }

                const target = plan.aggregate[name as keyof typeof plan.aggregate];
                if (!Array.isArray(target)) {
                    continue;
                }

                const fields = this.collectSelectionNodes(node.selectionSet, info)
                    .filter((child): child is FieldNode => child.kind === 'Field')
                    .map((child) => child.name.value)
                    .filter((fieldName) => Boolean(model.fieldMap.get(fieldName)));
                target.push(...fields);
            }
        }

        if (nodesField?.selectionSet) {
            const fields = this.collectSelectionNodes(nodesField.selectionSet, info).filter(
                (node): node is FieldNode => node.kind === 'Field'
            );
            plan.nodeSelection = this.buildSelectionFromFields(model, fields, info);
        }

        return plan;
    }

    private async resolveAggregate(
        model: NormalizedModelDefinition,
        client: TClient,
        args: Record<string, unknown>,
        info: GraphQLResolveInfo
    ) {
        const delegate = this.getRequiredDelegate(client, model);
        const plan = this.getAggregatePlan(model, info);
        const where = this.toWhere(model, args.where);
        const orderBy = this.toOrderBy(model, args.order_by);
        const take = typeof args.limit === 'number' ? args.limit : undefined;
        const skip = typeof args.offset === 'number' ? args.offset : undefined;

        let rawAggregate: Record<string, unknown> | undefined;
        if (plan.wantsAggregate) {
            this.assertMethod(delegate, 'aggregate', model);
            rawAggregate = await delegate.aggregate!({
                where,
                orderBy,
                take,
                skip,
                _count: plan.aggregate.count ? { _all: true } : undefined,
                _avg:
                    plan.aggregate.avg.length > 0
                        ? Object.fromEntries(plan.aggregate.avg.map((field) => [field, true]))
                        : undefined,
                _sum:
                    plan.aggregate.sum.length > 0
                        ? Object.fromEntries(plan.aggregate.sum.map((field) => [field, true]))
                        : undefined,
                _min:
                    plan.aggregate.min.length > 0
                        ? Object.fromEntries(plan.aggregate.min.map((field) => [field, true]))
                        : undefined,
                _max:
                    plan.aggregate.max.length > 0
                        ? Object.fromEntries(plan.aggregate.max.map((field) => [field, true]))
                        : undefined,
            });
        }

        let nodes: unknown[] = [];
        if (plan.wantsNodes) {
            this.assertMethod(delegate, 'findMany', model);
            nodes = await delegate.findMany!({
                where,
                orderBy,
                take,
                skip,
                select: plan.nodeSelection,
            });
        }

        return {
            aggregate: plan.wantsAggregate
                ? {
                      count: this.extractAggregateCount(rawAggregate),
                      avg: (rawAggregate?._avg as Record<string, unknown> | undefined) ?? null,
                      sum: (rawAggregate?._sum as Record<string, unknown> | undefined) ?? null,
                      min: (rawAggregate?._min as Record<string, unknown> | undefined) ?? null,
                      max: (rawAggregate?._max as Record<string, unknown> | undefined) ?? null,
                  }
                : null,
            nodes,
        };
    }

    private extractAggregateCount(rawAggregate: Record<string, unknown> | undefined) {
        const count = rawAggregate?._count;
        if (typeof count === 'number') {
            return count;
        }
        if (isPlainObject(count) && typeof count._all === 'number') {
            return count._all;
        }
        return 0;
    }

    private async resolveInsertMany(
        model: NormalizedModelDefinition,
        client: TClient,
        args: Record<string, unknown>,
        info: GraphQLResolveInfo
    ) {
        const delegate = this.getRequiredDelegate(client, model);
        const objects = Array.isArray(args.objects) ? args.objects : [];
        const returningSelection = this.getReturningSelection(model, info);
        const wantsReturning = Boolean(returningSelection);

        if (objects.length === 0) {
            return { affected_rows: 0, returning: [] };
        }

        if (!wantsReturning && delegate.createMany) {
            const result = await delegate.createMany({ data: objects });
            return { affected_rows: result.count, returning: [] };
        }

        if (wantsReturning && delegate.createManyAndReturn) {
            const rows = await delegate.createManyAndReturn({
                data: objects,
                select: returningSelection,
            });
            return {
                affected_rows: rows.length,
                returning: rows,
            };
        }

        this.assertMethod(delegate, 'create', model);
        const returning = [];
        for (const object of objects) {
            const created = await delegate.create!({
                data: object,
                select: returningSelection,
            });
            if (wantsReturning) {
                returning.push(created);
            }
        }

        return {
            affected_rows: objects.length,
            returning,
        };
    }

    private async resolveUpdateMany(
        model: NormalizedModelDefinition,
        client: TClient,
        args: Record<string, unknown>,
        info: GraphQLResolveInfo
    ) {
        const delegate = this.getRequiredDelegate(client, model);
        const where = this.toWhere(model, args.where);
        const data = this.buildMutationData(args);
        const returningSelection = this.getReturningSelection(model, info);
        const wantsReturning = Boolean(returningSelection);

        if (!wantsReturning && delegate.updateMany) {
            const result = await delegate.updateMany({ where, data });
            return { affected_rows: result.count, returning: [] };
        }

        this.assertMethod(delegate, 'findMany', model);
        this.assertMethod(delegate, 'update', model);
        const identifierFields = getIdentifierFields(model);
        if (identifierFields.length === 0) {
            throw new Error(`Model "${model.name}" requires a primary key or unique field for update returning`);
        }

        const identitySelection = Object.fromEntries(
            identifierFields.map((fieldName) => [fieldName, true])
        );
        const rows = await delegate.findMany!({
            where,
            select: identitySelection,
        });

        const returning = [];
        for (const row of rows as Record<string, unknown>[]) {
            const updated = await delegate.update!({
                where: this.buildUniqueWhereFromRecord(model, row),
                data,
                select: returningSelection,
            });
            if (wantsReturning) {
                returning.push(updated);
            }
        }

        return {
            affected_rows: rows.length,
            returning,
        };
    }

    private async resolveUpdateByPk(
        model: NormalizedModelDefinition,
        client: TClient,
        args: Record<string, unknown>,
        info: GraphQLResolveInfo
    ) {
        const delegate = this.getRequiredDelegate(client, model);
        this.assertMethod(delegate, 'update', model);
        const where = this.buildUniqueWhere(model, args);
        const data = this.buildMutationData(args);

        if (delegate.findUnique) {
            const existing = await delegate.findUnique({ where, select: { ...where } });
            if (!existing) {
                return null;
            }
        }

        return delegate.update!({
            where,
            data,
            select: this.buildSelection(model, info.fieldNodes, info),
        });
    }

    private async resolveDeleteMany(
        model: NormalizedModelDefinition,
        client: TClient,
        args: Record<string, unknown>,
        info: GraphQLResolveInfo
    ) {
        const delegate = this.getRequiredDelegate(client, model);
        const where = this.toWhere(model, args.where);
        const returningSelection = this.getReturningSelection(model, info);
        const wantsReturning = Boolean(returningSelection);

        if (!wantsReturning && delegate.deleteMany) {
            const result = await delegate.deleteMany({ where });
            return { affected_rows: result.count, returning: [] };
        }

        this.assertMethod(delegate, 'findMany', model);
        this.assertMethod(delegate, 'delete', model);
        const identifierFields = getIdentifierFields(model);
        if (identifierFields.length === 0) {
            throw new Error(`Model "${model.name}" requires a primary key or unique field for delete returning`);
        }

        const identitySelection = Object.fromEntries(
            identifierFields.map((fieldName) => [fieldName, true])
        );
        const rows = await delegate.findMany!({
            where,
            select: wantsReturning
                ? { ...identitySelection, ...(returningSelection ?? {}) }
                : identitySelection,
        });

        const returning = [];
        for (const row of rows as Record<string, unknown>[]) {
            const deleted = await delegate.delete!({
                where: this.buildUniqueWhereFromRecord(model, row),
                select: returningSelection,
            });
            if (wantsReturning) {
                returning.push(deleted ?? row);
            }
        }

        return {
            affected_rows: rows.length,
            returning,
        };
    }

    private async resolveDeleteByPk(
        model: NormalizedModelDefinition,
        client: TClient,
        args: Record<string, unknown>,
        info: GraphQLResolveInfo
    ) {
        const delegate = this.getRequiredDelegate(client, model);
        this.assertMethod(delegate, 'delete', model);
        const where = this.buildUniqueWhere(model, args);

        if (delegate.findUnique) {
            const existing = await delegate.findUnique({ where, select: { ...where } });
            if (!existing) {
                return null;
            }
        }

        return delegate.delete!({
            where,
            select: this.buildSelection(model, info.fieldNodes, info),
        });
    }
}

export function createZenStackGraphQLSchema<
    TClient extends ZenStackClientLike,
    TContext = unknown,
>(options: CreateZenStackGraphQLSchemaOptions<TClient, TContext>) {
    const builder = new SchemaBuilder(options);
    return builder.createSchema();
}
