import {
    GraphQLBoolean,
    GraphQLFloat,
    GraphQLID,
    GraphQLInputType,
    GraphQLInt,
    GraphQLList,
    GraphQLNonNull,
    GraphQLOutputType,
    GraphQLScalarType,
    GraphQLString,
    Kind,
    ValueNode,
} from 'graphql';

import type { ScalarType } from './types.js';

function parseJsonLiteral(ast: ValueNode): unknown {
    switch (ast.kind) {
        case Kind.STRING:
        case Kind.BOOLEAN:
            return ast.value;
        case Kind.INT:
        case Kind.FLOAT:
            return Number(ast.value);
        case Kind.NULL:
            return null;
        case Kind.OBJECT:
            return Object.fromEntries(
                ast.fields.map((field) => [field.name.value, parseJsonLiteral(field.value)])
            );
        case Kind.LIST:
            return ast.values.map((entry) => parseJsonLiteral(entry));
        default:
            return null;
    }
}

export const DateTimeScalar = new GraphQLScalarType({
    name: 'DateTime',
    serialize(value) {
        if (value instanceof Date) {
            return value.toISOString();
        }
        if (typeof value === 'string' || typeof value === 'number') {
            return new Date(value).toISOString();
        }
        throw new TypeError('DateTime values must be date-like');
    },
    parseValue(value) {
        return new Date(String(value)).toISOString();
    },
    parseLiteral(ast) {
        if (ast.kind !== Kind.STRING) {
            throw new TypeError('DateTime literals must be strings');
        }
        return new Date(ast.value).toISOString();
    },
});

export const DecimalScalar = new GraphQLScalarType({
    name: 'Decimal',
    serialize(value) {
        if (typeof value === 'number' || typeof value === 'string') {
            return value;
        }
        throw new TypeError('Decimal values must be numbers or strings');
    },
    parseValue(value) {
        return typeof value === 'number' || typeof value === 'string'
            ? value
            : String(value);
    },
    parseLiteral(ast) {
        if (ast.kind === Kind.STRING || ast.kind === Kind.FLOAT || ast.kind === Kind.INT) {
            return ast.value;
        }
        throw new TypeError('Decimal literals must be strings or numbers');
    },
});

export const JsonScalar = new GraphQLScalarType({
    name: 'Json',
    serialize(value) {
        return value;
    },
    parseValue(value) {
        return value;
    },
    parseLiteral(ast) {
        return parseJsonLiteral(ast);
    },
});

export const BigIntScalar = new GraphQLScalarType({
    name: 'BigInt',
    serialize(value) {
        return typeof value === 'bigint' ? value.toString() : String(value);
    },
    parseValue(value) {
        if (typeof value === 'bigint') {
            return value;
        }
        return BigInt(String(value));
    },
    parseLiteral(ast) {
        if (ast.kind === Kind.INT || ast.kind === Kind.STRING) {
            return BigInt(ast.value);
        }
        throw new TypeError('BigInt literals must be ints or strings');
    },
});

const DEFAULT_SCALARS: Record<ScalarType, GraphQLScalarType> = {
    ID: GraphQLID,
    String: GraphQLString,
    Int: GraphQLInt,
    Float: GraphQLFloat,
    Boolean: GraphQLBoolean,
    DateTime: DateTimeScalar,
    Decimal: DecimalScalar,
    Json: JsonScalar,
    BigInt: BigIntScalar,
};

export function getScalarType(
    scalar: ScalarType,
    overrides?: Partial<Record<ScalarType, GraphQLScalarType>>
) {
    return overrides?.[scalar] ?? DEFAULT_SCALARS[scalar];
}

export function maybeWrapList<TType extends GraphQLInputType | GraphQLOutputType>(
    type: TType,
    isList: boolean | undefined,
    isNullable: boolean | undefined
) {
    const baseType = isList ? new GraphQLList(type) : type;
    if (isNullable) {
        return baseType;
    }
    return new GraphQLNonNull(baseType);
}
