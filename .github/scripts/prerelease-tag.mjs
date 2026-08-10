import { readFileSync, appendFileSync } from 'node:fs';

const API = 'https://api.github.com';
const PREVIEW_MARKER = '<!-- geopixelcons-prerelease -->';

function parseVersion(value) {
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value));
    return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null;
}

function compareVersions(left, right) {
    return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function formatVersion(version) {
    return `${version.major}.${version.minor}.${version.patch}`;
}

export function branchSlug(branch) {
    const slug = String(branch)
        .toLowerCase()
        .replace(/[^0-9a-z-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48);
    return slug || 'change';
}

export function chooseBump({ labels = [], title = '' }) {
    const names = labels.map((label) => typeof label === 'string' ? label : label.name);
    if (names.includes('release:minor') && names.includes('release:patch')) {
        throw new Error('A PR cannot have both release:minor and release:patch labels.');
    }
    if (names.includes('release:minor')) return 'minor';
    if (names.includes('release:patch')) return 'patch';
    return /^feat(?:\([^)]*\))?!?:/i.test(String(title).trim()) ? 'minor' : 'patch';
}

export function selectPreview({ stableVersion, bootstrapVersion, branch, labels, title, tags = [] }) {
    const stable = stableVersion ? parseVersion(stableVersion) : null;
    const baseline = stable || parseVersion(bootstrapVersion);
    if (!baseline) throw new Error('A valid stable or bootstrap semantic version is required.');
    const bump = chooseBump({ labels, title });
    const next = stable
        ? (bump === 'minor'
            ? { major: baseline.major, minor: baseline.minor + 1, patch: 0 }
            : { major: baseline.major, minor: baseline.minor, patch: baseline.patch + 1 })
        : baseline;
    const slug = branchSlug(branch);
    const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const numberPattern = new RegExp(`^v\\d+\\.\\d+\\.\\d+-${escapedSlug}-(\\d+)$`);
    const number = tags.reduce((maximum, tag) => {
        const match = numberPattern.exec(tag);
        return match ? Math.max(maximum, Number(match[1])) : maximum;
    }, 0) + 1;
    return { tag: `v${formatVersion(next)}-${slug}-${number}`, version: formatVersion(next), bump, number };
}

async function api(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
        ...options,
        headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
            'x-github-api-version': '2022-11-28',
            ...(options.headers || {}),
        },
    });
    if (!response.ok) {
        const body = await response.text();
        const error = new Error(`${options.method || 'GET'} ${path} failed (${response.status}): ${body}`);
        error.status = response.status;
        throw error;
    }
    return response.status === 204 ? null : response.json();
}

function output(name, value) {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function bodyFor({ tag, bump, sha }) {
    return `${PREVIEW_MARKER}\n## PR preview: \`${tag}\`\n\n- SemVer policy: **${bump}**\n- Immutable source commit: \`${sha}\`\n- This is a test prerelease, never a Greasyfork dependency.`;
}

async function latestStableVersion(repository) {
    const releases = await api(`/repos/${repository}/releases?per_page=100`);
    const candidates = releases
        .filter((release) => !release.draft && !release.prerelease)
        .map((release) => ({ version: parseVersion(release.tag_name), tag: release.tag_name }))
        .filter((release) => release.version)
        .sort((left, right) => compareVersions(right.version, left.version));
    return candidates[0]?.tag || null;
}

async function allTags(repository) {
    const refs = await api(`/repos/${repository}/git/matching-refs/tags/v`);
    return refs.map((ref) => ref.ref.replace('refs/tags/', ''));
}

async function upsertComment(repository, number, body) {
    const comments = await api(`/repos/${repository}/issues/${number}/comments?per_page=100`);
    const existing = comments.find((comment) => comment.body?.includes(PREVIEW_MARKER));
    if (existing) {
        await api(`/repos/${repository}/issues/comments/${existing.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ body }),
        });
    } else {
        await api(`/repos/${repository}/issues/${number}/comments`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ body }),
        });
    }
}

async function main() {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const pr = event.pull_request;
    const repository = process.env.GITHUB_REPOSITORY;
    if (!pr || pr.base.ref !== 'main') return;
    if (pr.head.repo?.full_name !== repository) {
        console.log('Skipping fork PR: preview tags are created only for same-repository branches.');
        return;
    }

    const bootstrapVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
    const stableTag = await latestStableVersion(repository);
    let tags = await allTags(repository);
    let preview;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        preview = selectPreview({
            stableVersion: stableTag,
            bootstrapVersion,
            branch: pr.head.ref,
            labels: pr.labels || [],
            title: pr.title,
            tags,
        });
        try {
            await api(`/repos/${repository}/git/refs`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ ref: `refs/tags/${preview.tag}`, sha: pr.head.sha }),
            });
            break;
        } catch (error) {
            if (error.status !== 422 || attempt === 4) throw error;
            tags = await allTags(repository);
        }
    }

    const releaseBody = bodyFor({ tag: preview.tag, bump: preview.bump, sha: pr.head.sha });
    await api(`/repos/${repository}/releases`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            tag_name: preview.tag,
            target_commitish: pr.head.sha,
            name: `Preview ${preview.tag}`,
            body: releaseBody,
            prerelease: true,
            draft: false,
            make_latest: 'false',
        }),
    });
    await upsertComment(repository, pr.number, `${releaseBody}\n\n[Open preview release](https://github.com/${repository}/releases/tag/${preview.tag})`);
    output('tag', preview.tag);
    console.log(`Created ${preview.tag} from ${pr.head.sha}.`);
}

if (process.env.GITHUB_EVENT_PATH && process.env.GITHUB_REPOSITORY && process.env.GITHUB_TOKEN) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
