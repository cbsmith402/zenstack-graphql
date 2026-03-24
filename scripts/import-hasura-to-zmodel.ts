#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

import { importHasuraToZModel } from '../src/hasura-importer.js';

type CliOptions = {
    metadataDir?: string;
    databaseUrl?: string;
    sourceName?: string;
    out?: string;
    includeViews: boolean;
    schemaFilter: string[];
    stdout: boolean;
    report: boolean;
};

function parseArgs(argv: string[]): CliOptions {
    const options: CliOptions = {
        includeViews: true,
        schemaFilter: [],
        stdout: false,
        report: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        const next = argv[index + 1];
        switch (arg) {
            case '--metadata-dir':
                options.metadataDir = next;
                index++;
                break;
            case '--database-url':
                options.databaseUrl = next;
                index++;
                break;
            case '--source':
                options.sourceName = next;
                index++;
                break;
            case '--out':
                options.out = next;
                index++;
                break;
            case '--include-views':
                options.includeViews = next === undefined || next !== 'false';
                if (next && !next.startsWith('--')) {
                    index++;
                }
                break;
            case '--schema-filter':
                if (next) {
                    options.schemaFilter.push(...next.split(',').map((entry) => entry.trim()).filter(Boolean));
                    index++;
                }
                break;
            case '--stdout':
                options.stdout = true;
                break;
            case '--report':
                options.report = true;
                break;
            default:
                if (arg.startsWith('--')) {
                    throw new Error(`Unknown argument: ${arg}`);
                }
                break;
        }
    }

    return options;
}

function renderReport(result: Awaited<ReturnType<typeof importHasuraToZModel>>['result']) {
    const lines = [
        `Imported source: ${result.sourceName}`,
        `Imported tables: ${result.summary.importedTables}`,
        `Imported views: ${result.summary.importedViews}`,
        `Commented view stubs: ${result.summary.commentedViewStubs}`,
        `Roles translated: ${result.summary.rolesTranslated}`,
        `Permissions translated: ${result.summary.permissionsTranslated}`,
        `Permissions with TODOs: ${result.summary.permissionsWithTodos}`,
        `Unsupported operators: ${
            Object.keys(result.summary.unsupportedOperators).length > 0
                ? JSON.stringify(result.summary.unsupportedOperators)
                : '{}'
        }`,
    ];

    if (result.warnings.length > 0) {
        lines.push('Warnings:');
        for (const warning of result.warnings) {
            lines.push(`- ${warning.scope}: ${warning.message}`);
        }
    }

    return lines.join('\n');
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (!options.metadataDir) {
        throw new Error('--metadata-dir is required');
    }
    if (!options.databaseUrl) {
        throw new Error('--database-url is required');
    }
    if (!options.stdout && !options.out) {
        throw new Error('--out is required unless --stdout is used');
    }

    const imported = await importHasuraToZModel({
        metadataDir: path.resolve(options.metadataDir),
        databaseUrl: options.databaseUrl,
        sourceName: options.sourceName,
        includeViews: options.includeViews,
        schemaFilter: options.schemaFilter,
    });

    if (options.stdout) {
        process.stdout.write(imported.zmodel);
    } else if (options.out) {
        await fs.writeFile(path.resolve(options.out), imported.zmodel, 'utf8');
    }

    if (options.report) {
        process.stderr.write(renderReport(imported.result) + '\n');
    }
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`import-hasura-to-zmodel failed: ${message}\n`);
    process.exitCode = 1;
});
