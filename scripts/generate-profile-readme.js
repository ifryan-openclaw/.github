#!/usr/bin/env node

/**
 * Generate simplified GitHub Organization Profile README
 * Usage: node scripts/generate-profile-readme.js [org]
 */

const fs = require('fs');
const path = require('path');

const ORG = process.argv[2] || process.env.ORG_NAME || process.env.GITHUB_REPOSITORY_OWNER || 'ifryan-openclaw';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const API = 'https://api.github.com';

async function ghApi(apiPath) {
  const res = await fetch(`${API}${apiPath}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ifryan-openclaw-profile-readme-generator',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });

  const remaining = Number(res.headers.get('x-ratelimit-remaining') || 0);
  const reset = Number(res.headers.get('x-ratelimit-reset') || 0);

  if (res.status === 403 && remaining === 0) {
    const waitSec = Math.max(0, reset - Math.floor(Date.now() / 1000));
    throw new Error(`GitHub API rate limit exceeded. Reset in ~${waitSec}s`);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status} ${apiPath}: ${text}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function fetchOrgRepos(org) {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const data = await ghApi(`/orgs/${org}/repos?type=all&per_page=100&page=${page}&sort=full_name&direction=asc`);
    all.push(...data);
    if (data.length < 100) break;
  }
  return all;
}

function visibilityLabel(repo) {
  const visibility = repo.visibility || (repo.private ? 'private' : 'public');
  return visibility ? `\`${visibility}\`` : '';
}

function buildReadme(org, repos) {
  const lines = repos.map((r) => {
    const label = visibilityLabel(r);
    const suffix = label ? ` ${label}` : '';
    return `- [${r.name}](${r.html_url})${suffix}`;
  });

  return `# ${org} 仓库列表\n\n- 当前仓库总数：**${repos.length}**\n\n## Repositories\n\n${lines.join('\n') || '- （暂无仓库）'}\n`;
}

async function main() {
  console.log(`[info] generating simplified profile README for org: ${ORG}`);

  const repos = await fetchOrgRepos(ORG);
  repos.sort((a, b) => a.name.localeCompare(b.name));

  const readme = buildReadme(ORG, repos);

  const out = path.join(process.cwd(), 'profile', 'README.md');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, readme, 'utf8');

  console.log(`[ok] README generated: ${out}`);
}

main().catch((err) => {
  console.error('[error]', err.message || err);
  process.exit(1);
});
