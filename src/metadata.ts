import type {
    EnumDefinition,
    FieldDefinition,
    ModelDefinition,
    NormalizedEnumDefinition,
    NormalizedFieldDefinition,
    NormalizedModelDefinition,
    NormalizedSchema,
    UniqueConstraintDefinition,
    ZenStackSchemaLike,
} from './types.js';

function toArray<T>(value: T[] | Record<string, T> | undefined): T[] {
    if (!value) {
        return [];
    }
    return Array.isArray(value) ? value : Object.values(value);
}

function normalizeField(fieldName: string, field: FieldDefinition): NormalizedFieldDefinition {
    return {
        ...field,
        name: field.name ?? fieldName,
        type: field.type,
    };
}

function normalizeFields(fields: ModelDefinition['fields']): NormalizedFieldDefinition[] {
    if (Array.isArray(fields)) {
        return fields.map((field) => normalizeField(field.name, field));
    }

    return Object.entries(fields).map(([fieldName, field]) =>
        normalizeField(fieldName, field)
    );
}

function normalizeUniqueConstraints(
    fields: NormalizedFieldDefinition[],
    constraints: UniqueConstraintDefinition[] | undefined
): UniqueConstraintDefinition[] {
    const result = constraints ? [...constraints] : [];
    for (const field of fields) {
        if (field.isId || field.isUnique) {
            result.push({ fields: [field.name] });
        }
    }

    const seen = new Set<string>();
    return result.filter((constraint) => {
        const key = constraint.fields.join('|');
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function normalizeModel(modelName: string, model: ModelDefinition): NormalizedModelDefinition {
    const fields = normalizeFields(model.fields);
    const uniqueConstraints = normalizeUniqueConstraints(fields, model.uniqueConstraints);
    const primaryKey =
        model.primaryKey ??
        fields
            .filter((field) => field.isId)
            .map((field) => field.name);

    return {
        name: model.name ?? modelName,
        dbName: model.dbName,
        description: model.description,
        fields,
        fieldMap: new Map(fields.map((field) => [field.name, field])),
        primaryKey,
        uniqueConstraints,
    };
}

function normalizeEnum(enumName: string, enumDefinition: EnumDefinition): NormalizedEnumDefinition {
    const values = Array.isArray(enumDefinition.values)
        ? enumDefinition.values
        : Object.keys(enumDefinition.values);
    return {
        name: enumDefinition.name ?? enumName,
        values,
        description: enumDefinition.description,
    };
}

export function normalizeSchema(schema: ZenStackSchemaLike | ModelDefinition[]): NormalizedSchema {
    const schemaInput: ZenStackSchemaLike = Array.isArray(schema)
        ? { models: schema }
        : schema;

    const modelsRaw = schemaInput.models ?? schemaInput.modelMeta;
    const enumsRaw = schemaInput.enums ?? schemaInput.enumMeta;

    const models = Array.isArray(modelsRaw)
        ? modelsRaw.map((model) => normalizeModel(model.name, model as ModelDefinition))
        : Object.entries(modelsRaw ?? {}).map(([modelName, model]) =>
              normalizeModel(modelName, { ...(model as ModelDefinition), name: modelName })
          );
    const enums = Array.isArray(enumsRaw)
        ? enumsRaw.map((entry) => normalizeEnum(entry.name, entry as EnumDefinition))
        : Object.entries(enumsRaw ?? {}).map(([enumName, entry]) =>
              normalizeEnum(enumName, { ...(entry as EnumDefinition), name: enumName })
          );

    return {
        models,
        modelMap: new Map(models.map((model) => [model.name, model])),
        enums,
        enumMap: new Map(enums.map((entry) => [entry.name, entry])),
    };
}

export function getIdentifierFields(model: NormalizedModelDefinition): string[] {
    if (model.primaryKey.length > 0) {
        return model.primaryKey;
    }

    const firstUnique = model.uniqueConstraints[0];
    if (firstUnique) {
        return firstUnique.fields;
    }

    return model.fields.filter((field) => field.isId || field.isUnique).map((field) => field.name);
}

export function getScalarFields(model: NormalizedModelDefinition) {
    return model.fields.filter((field) => field.kind === 'scalar' || field.kind === 'enum');
}

export function getRelationFields(model: NormalizedModelDefinition) {
    return model.fields.filter((field) => field.kind === 'relation');
}

export function isNumericScalar(type: string) {
    return type === 'Int' || type === 'Float' || type === 'Decimal' || type === 'BigInt';
}

export function isComparableScalar(type: string) {
    return (
        type === 'String' ||
        type === 'Int' ||
        type === 'Float' ||
        type === 'Decimal' ||
        type === 'BigInt' ||
        type === 'DateTime' ||
        type === 'ID'
    );
}

export function isMutableField(field: NormalizedFieldDefinition, exposeInternalFields: boolean) {
    if (field.kind === 'relation') {
        return false;
    }
    if (field.isReadOnly || field.isComputed) {
        return false;
    }
    if (!exposeInternalFields && field.isInternal) {
        return false;
    }
    return true;
}
