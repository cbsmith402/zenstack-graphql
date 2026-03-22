import { GraphQLError } from 'graphql';

const AUTH_NAMES = new Set(['ZenStackAuthError', 'ForbiddenError', 'UnauthorizedError']);
const VALIDATION_NAMES = new Set(['ZenStackValidationError', 'ValidationError']);
const NOT_FOUND_NAMES = new Set(['NotFoundError', 'ZenStackNotFoundError']);

export function normalizeError(error: unknown): GraphQLError {
    if (error instanceof GraphQLError) {
        if (error.extensions?.code) {
            return error;
        }

        const candidate = getErrorCandidate(error.originalError ?? error);
        return new GraphQLError(error.message, {
            nodes: error.nodes,
            source: error.source,
            positions: error.positions,
            path: error.path,
            originalError: error.originalError ?? error,
            extensions: {
                ...error.extensions,
                ...getErrorExtensions(candidate),
            },
        });
    }

    const candidate = getErrorCandidate(error);
    const message = candidate?.message ?? 'Unexpected GraphQL adapter failure';
    return new GraphQLError(message, {
        extensions: getErrorExtensions(candidate),
    });
}

function getErrorCode(error: { name?: string; code?: string; message?: string } | undefined) {
    if (!error) {
        return 'INTERNAL_SERVER_ERROR';
    }

    if (AUTH_NAMES.has(error.name ?? '')) {
        return 'FORBIDDEN';
    }

    if (VALIDATION_NAMES.has(error.name ?? '')) {
        return 'BAD_USER_INPUT';
    }

    if (NOT_FOUND_NAMES.has(error.name ?? '')) {
        return 'NOT_FOUND';
    }

    if (typeof error.code === 'string' && error.code.length > 0) {
        return error.code;
    }

    return 'INTERNAL_SERVER_ERROR';
}

function getErrorExtensions(error: {
    name?: string;
    code?: string;
    message?: string;
    details?: unknown;
}) {
    const extensions: Record<string, unknown> = {
        code: getErrorCode(error),
    };

    if (error?.details !== undefined) {
        extensions.details = error.details;
    }

    if (error?.code && typeof error.code === 'string') {
        extensions.originalCode = error.code;
    }

    return extensions;
}

function getErrorCandidate(error: unknown, depth = 0): {
    name?: string;
    code?: string;
    message?: string;
    details?: unknown;
} {
    const candidate = (error ?? {}) as {
        name?: string;
        code?: string;
        message?: string;
        details?: unknown;
        cause?: unknown;
    };

    if (depth >= 3 || !candidate.cause) {
        return candidate;
    }

    const cause = getErrorCandidate(candidate.cause, depth + 1);
    const preferredName =
        !candidate.name || candidate.name === 'Error' ? cause.name : candidate.name;
    return {
        name: preferredName,
        code: candidate.code ?? cause.code,
        message: candidate.message ?? cause.message,
        details: candidate.details ?? cause.details,
    };
}
