#!/usr/bin/env node

/**
 * Generate GitHub Organization Profile README
 * Usage: node scripts/generate-profile-readme.js [org]
 */

const fs = require('fs');
const path = require('path');

const ORG = process.argv[2] || process.env.ORG_NAME || process.env.GITHUB_REPOSITORY_OWNER || 'ifryan-openclaw';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const API = 'https://api.github.com';

const BLOCKS = ['⬜', '🟩', '🟨', '🟧', '🟥'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

async function ghApi(apiPath, { silent = false } = {}) {
  const res = await fetch(`${API}${apiPath}`, {
    headers: {
      'Accept': 'application/vnd.github+json',
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

  if (!silent && remaining > 0 && remaining < 50) {
    console.warn(`[warn] API remaining quota is low: ${remaining}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function fetchOrgRepos(org) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const data = await ghApi(`/orgs/${org}/repos?type=public&per_page=100&page=${page}&sort=updated`);
    all.push(...data);
    if (data.length < 100) break;
  }
  return all;
}

async function fetchCommitActivity(owner, repo) {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${API}/repos/${owner}/${repo}/stats/commit_activity`, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'ifryan-openclaw-profile-readme-generator',
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
    });

    if (res.status === 202) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }

    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    const json = JSON.parse(text);
    if (Array.isArray(json)) return json;
    return null;
  }
  return null;
}

function toDate(s) {
  return s ? new Date(s) : null;
}

function fmtDate(s) {
  const d = toDate(s);
  return d ? d.toISOString().slice(0, 10) : '-';
}

function level(v, max) {
  if (!max || v <= 0) return 0;
  const ratio = v / max;
  if (ratio < 0.25) return 1;
  if (ratio < 0.5) return 2;
  if (ratio < 0.75) return 3;
  return 4;
}

function renderHeatmap(daysMatrix) {
  const flat = daysMatrix.flat();
  const max = Math.max(...flat, 0);
  const header = '| Weekday \\ Week | ' + Array.from({ length: 12 }, (_, i) => `W-${11 - i}`).join(' | ') + ' |\n'
    + '|---|' + Array.from({ length: 12 }, () => '---').join('|') + '|\n';

  const rows = WEEKDAYS.map((day, r) => {
    const cells = daysMatrix[r].map((v) => `${BLOCKS[level(v, max)]} ${v}`);
    return `| ${day} | ${cells.join(' | ')} |`;
  }).join('\n');

  return `${header}${rows}`;
}

function buildReadme(org, repos, heatmapMd, totals) {
  const now = new Date().toISOString().replace('T', ' ').replace('Z', ' UTC');

  const tableRows = repos.map((r) => {
    const name = `[${r.name}](${r.html_url})`;
    const desc = (r.description || '-').replace(/\|/g, '\\|');
    const archived = r.archived ? ' 🗄️' : '';
    return `| ${name}${archived} | ${desc} | ${r.stargazers_count} | ${r.forks_count} | ${r.open_issues_count} | ${fmtDate(r.pushed_at)} |`;
  }).join('\n');

  return `# ifryan-openclaw 组织主页\n\n欢迎来到 **ifryan-openclaw**！\n\n我们通过自动化流程维护组织级别看板，实时展示仓库状态与近 12 周活跃趋势。\n\n## 📌 组织简介\n\n- 组织名称：\`${org}\`\n- 自动化更新：GitHub Actions（定时 + 手动）\n- 数据来源：GitHub REST API（\`GITHUB_TOKEN\`）\n\n## 📦 仓库总览（自动生成）\n\n- 公共仓库总数：**${totals.repoCount}**\n- 总 Stars：**${totals.stars}**\n- 总 Forks：**${totals.forks}**\n- 总 Open Issues：**${totals.issues}**\n- 最近更新时间：**${totals.latestUpdate || '-'}**\n\n## 🧭 各仓库关键信息\n\n| Repository | Description | ⭐ Stars | 🍴 Forks | 🐞 Open Issues | 🕒 Last Updated |\n|---|---|---:|---:|---:|---|\n${tableRows || '| - | - | - | - | - | - |'}\n\n## 🔥 组织活跃热力图（最近 12 周）\n\n> 说明：基于组织内仓库 \`stats/commit_activity\` 聚合生成。色块越暖表示活跃度越高。\n\n${heatmapMd}\n\n---\n\n_该页面由工作流自动生成。最后更新时间：${now}_\n`;
}

async function main() {
  console.log(`[info] generating profile README for org: ${ORG}`);

  const reposRaw = await fetchOrgRepos(ORG);
  const repos = reposRaw
    .filter((r) => !r.private)
    .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at));

  const totals = {
    repoCount: repos.length,
    stars: repos.reduce((s, r) => s + (r.stargazers_count || 0), 0),
    forks: repos.reduce((s, r) => s + (r.forks_count || 0), 0),
    issues: repos.reduce((s, r) => s + (r.open_issues_count || 0), 0),
    latestUpdate: repos[0] ? fmtDate(repos[0].pushed_at) : '-',
  };

  const days7x12 = Array.from({ length: 7 }, () => Array(12).fill(0));

  for (const repo of repos) {
    const activity = await fetchCommitActivity(ORG, repo.name);
    if (!activity || activity.length < 12) continue;
    const last12 = activity.slice(-12);
    for (let w = 0; w < last12.length; w++) {
      const days = last12[w].days || [];
      for (let d = 0; d < 7; d++) {
        days7x12[d][w] += Number(days[d] || 0);
      }
    }
  }

  // GitHub API day index: Sun(0)...Sat(6) -> rotate to Mon...Sun
  const reordered = [1, 2, 3, 4, 5, 6, 0].map((idx) => days7x12[idx]);
  const heatmapMd = renderHeatmap(reordered);

  const readme = buildReadme(ORG, repos, heatmapMd, totals);

  const out = path.join(process.cwd(), 'profile', 'README.md');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, readme, 'utf8');

  console.log(`[ok] README generated: ${out}`);
}

main().catch((err) => {
  console.error('[error]', err.message || err);
  process.exit(1);
});
