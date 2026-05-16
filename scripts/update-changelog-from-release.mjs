import fs from 'node:fs/promises';

const changelogPath = process.env.CHANGELOG_PATH ?? 'CHANGELOG.md';
const releaseTag = process.env.RELEASE_TAG?.trim();
const releaseBody = normalizeBody(process.env.RELEASE_BODY ?? '');
const releasePublishedAt = process.env.RELEASE_PUBLISHED_AT?.trim();

if (!releaseTag) {
    throw new Error('RELEASE_TAG is required');
}

const version = releaseTag.replace(/^v/, '');
const date = (releasePublishedAt ?? new Date().toISOString()).slice(0, 10);
const heading = `## ${version} - ${date}`;
const content = await fs.readFile(changelogPath, 'utf8');
const sectionBody = releaseBody.length > 0 ? releaseBody : 'Release notes published on GitHub.';
const nextSectionPattern = /^##\s+/m;
const existingIndex = content.indexOf(heading);
const newSection = `${heading}\n\n${sectionBody}\n`;

let updated;

if (existingIndex >= 0) {
    const afterHeading = content.slice(existingIndex + heading.length);
    const nextMatch = nextSectionPattern.exec(afterHeading);
    const sectionEnd =
        nextMatch && nextMatch.index !== undefined
            ? existingIndex + heading.length + nextMatch.index
            : content.length;
    updated = `${content.slice(0, existingIndex)}${newSection}\n${content.slice(sectionEnd).replace(/^\n*/, '')}`;
} else {
    const anchor = 'All notable changes to `zenstack-graphql` will be documented in this file.\n';
    const anchorIndex = content.indexOf(anchor);

    if (anchorIndex < 0) {
        throw new Error(`Could not find changelog intro in ${changelogPath}`);
    }

    const insertAt = anchorIndex + anchor.length;
    updated = `${content.slice(0, insertAt)}\n${newSection}\n${content.slice(insertAt).replace(/^\n*/, '')}`;
}

if (!updated.endsWith('\n')) {
    updated += '\n';
}

await fs.writeFile(changelogPath, updated, 'utf8');

function normalizeBody(value) {
    const normalized = value.replace(/\r\n/g, '\n').trim();
    return normalized;
}
