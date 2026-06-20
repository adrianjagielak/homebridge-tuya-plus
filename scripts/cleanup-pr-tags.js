#!/usr/bin/env node
'use strict';

/**
 * Prune stale `pr-<N>` npm dist-tags created by the `/publish` PR-test-build
 * workflow (.github/workflows/publish-dev.yml).
 *
 * Token-free by design: it shells out to `npm dist-tag`, which uses your
 * existing local npm login — the same one you use to publish releases. No CI
 * secret is involved. (npm's OIDC trusted publishing only covers `npm publish`,
 * not dist-tag management, which is why this is a local maintainer script
 * rather than a CI job.)
 *
 * Default: removes the `pr-<N>` tag for every PR that is MERGED or CLOSED, and
 * keeps tags for PRs that are still open. PR state is read from the public
 * GitHub API (unauthenticated).
 *
 * Usage:
 *   npm run cleanup:pr-tags                # remove tags for merged/closed PRs
 *   npm run cleanup:pr-tags -- --dry-run   # preview only, change nothing
 *   npm run cleanup:pr-tags -- --all       # remove ALL pr-* tags (incl. open)
 *
 * Note: this removes the dist-tag pointer only. The underlying prerelease
 * versions stay published (npm disallows unpublishing after 72h), but they sort
 * below `latest`/`dev` and are never installed by default.
 */

const { execFileSync } = require('child_process');
const path = require('path');

const pkgJson = require(path.join(__dirname, '..', 'package.json'));
const PKG = pkgJson.name;
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run') || args.includes('-n');
const ALL = args.includes('--all');

// Derive "owner/repo" from package.json's repository URL.
function repoSlug() {
  const url = (pkgJson.repository && pkgJson.repository.url) || '';
  const m = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/i);
  if (!m) throw new Error(`Cannot parse a GitHub repo from repository.url: "${url}"`);
  return `${m[1]}/${m[2]}`;
}

// Parse `npm dist-tag ls <pkg>` output ("pr-57: 3.14.0-pr.57.3") into pr-* tags.
function listPrTags() {
  let out;
  try {
    out = execFileSync(NPM, ['dist-tag', 'ls', PKG], { encoding: 'utf8' });
  } catch (err) {
    throw new Error(`Failed to list dist-tags for ${PKG}: ${err.message}`);
  }
  const tags = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^(pr-(\d+)):\s*(.+)$/);
    if (m) tags.push({ tag: m[1], pr: Number(m[2]), version: m[3].trim() });
  }
  return tags;
}

async function prState(slug, num) {
  const res = await fetch(`https://api.github.com/repos/${slug}/pulls/${num}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `${PKG}-cleanup` },
  });
  if (res.status === 404) return 'unknown';
  if (!res.ok) throw new Error(`GitHub API responded ${res.status}`);
  const data = await res.json();
  return data.merged ? 'merged' : data.state; // 'merged' | 'open' | 'closed'
}

async function main() {
  const slug = repoSlug();
  const tags = listPrTags();
  if (tags.length === 0) {
    console.log(`No pr-* dist-tags on ${PKG}. Nothing to do.`);
    return;
  }
  console.log(`Found ${tags.length} pr-* tag(s) on ${PKG}${DRY_RUN ? ' (dry run)' : ''}:`);

  let removed = 0;
  for (const { tag, pr, version } of tags) {
    let remove = ALL;
    let reason = 'forced by --all';
    if (!ALL) {
      let state;
      try {
        state = await prState(slug, pr);
      } catch (err) {
        console.log(`  • ${tag} -> ${version}: skip (could not check PR #${pr}: ${err.message})`);
        continue;
      }
      remove = state === 'merged' || state === 'closed';
      reason = `PR #${pr} is ${state}`;
    }

    if (!remove) {
      console.log(`  • ${tag} -> ${version}: keep (${reason})`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`  • ${tag} -> ${version}: would remove (${reason})`);
      removed++;
      continue;
    }
    try {
      execFileSync(NPM, ['dist-tag', 'rm', PKG, tag], { encoding: 'utf8' });
      console.log(`  • ${tag} -> ${version}: removed (${reason})`);
      removed++;
    } catch (err) {
      console.log(`  • ${tag}: FAILED to remove (${err.message}). Are you \`npm login\`'d?`);
    }
  }

  console.log(DRY_RUN ? `Would remove ${removed} tag(s).` : `Removed ${removed} tag(s).`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
