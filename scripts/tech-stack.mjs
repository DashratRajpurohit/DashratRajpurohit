// Builds the animated tech-stack banner used in the README:
//   assets/tech-stack-dark.svg and assets/tech-stack-light.svg
//
// Edit ROWS below, then run from the repo root:  node scripts/tech-stack.mjs
// Icons come from https://skillicons.dev (ids listed at https://github.com/tandpfun/skill-icons#icons-list)
// and are embedded in the SVG, so the banner has no runtime dependency on any service.

import { writeFile } from "node:fs/promises";

const ROWS = [
  {
    label: "Languages",
    icons: [
      ["c", "C"], ["cpp", "C++"], ["js", "JavaScript"], ["ts", "TypeScript"],
      ["python", "Python"], ["html", "HTML"], ["css", "CSS"], ["bash", "Bash"],
    ],
  },
  {
    label: "Frontend",
    icons: [
      ["react", "React"], ["angular", "Angular"], ["vite", "Vite"], ["tailwind", "Tailwind"],
      ["redux", "Redux"], ["materialui", "MUI"], ["threejs", "Three.js"], ["figma", "Figma"],
    ],
  },
  {
    label: "Backend & data",
    icons: [
      ["nodejs", "Node.js"], ["express", "Express"], ["django", "Django"], ["mongodb", "MongoDB"],
      ["mysql", "MySQL"], ["redis", "Redis"], ["prisma", "Prisma"], ["postman", "Postman"],
    ],
  },
  {
    label: "Tools & cloud",
    icons: [
      ["git", "Git"], ["github", "GitHub"], ["githubactions", "Actions"], ["kubernetes", "Kubernetes"],
      ["vscode", "VS Code"], ["npm", "npm"], ["pnpm", "pnpm"], ["vitest", "Vitest"],
      ["vercel", "Vercel"], ["netlify", "Netlify"], ["linux", "Linux"], ["arch", "Arch"],
    ],
  },
];

const THEMES = {
  dark: {
    icons: "dark", bg: "#0d1117", border: "#30363d", bar: "#161b22", rule: "#21262d",
    text: "#e6edf3", muted: "#8b949e", accent: "#3fb950",
  },
  light: {
    icons: "light", bg: "#ffffff", border: "#d0d7de", bar: "#f6f8fa", rule: "#eaeef2",
    text: "#1f2328", muted: "#59636e", accent: "#1a7f37",
  },
};

const WIDTH = 840;
const BAR_H = 40;
const ROW_H = 86;
const LABEL_W = 150;
const PAD = 20;
const ICON = 44;
const SLOT = 78;
const SPEED = 28; // px per second
const FADE = 40;

const SANS = "'Segoe UI', Ubuntu, 'Helvetica Neue', Arial, sans-serif";
const MONO = "'SF Mono', 'Cascadia Code', Consolas, 'Liberation Mono', monospace";

async function fetchIcon(id, theme) {
  const res = await fetch(`https://skillicons.dev/icons?i=${id}&theme=${theme}`);
  if (!res.ok) throw new Error(`skillicons: ${id} (${theme}) -> HTTP ${res.status}`);
  const svg = await res.text();
  // The response wraps the 256x256 icon in an outer <svg><g>...</g></svg>; keep only the icon body.
  const open = svg.match(/<g transform="translate\(0, 0\)">\s*<svg[^>]*>/);
  if (!open) throw new Error(`skillicons: unexpected markup for ${id}`);
  const body = svg
    .slice(open.index + open[0].length)
    .replace(/<\/svg>\s*<\/g>\s*<\/svg>\s*$/, "");
  // Icons reuse gradient/clip ids, so namespace them per icon.
  return body
    .replace(/\bid="([^"]+)"/g, `id="${id}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${id}-$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${id}-$1"`);
}

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function build(themeName) {
  const t = THEMES[themeName];
  const total = ROWS.reduce((n, r) => n + r.icons.length, 0);
  const height = BAR_H + ROWS.length * ROW_H + 12;
  const areaX = PAD + LABEL_W;
  const areaW = WIDTH - areaX - PAD;

  const symbols = [];
  for (const row of ROWS) {
    for (const [id] of row.icons) {
      symbols.push(`<symbol id="ic-${id}" viewBox="0 0 256 256">${await fetchIcon(id, t.icons)}</symbol>`);
    }
  }

  const keyframes = [];
  const rows = ROWS.map((row, i) => {
    const y = BAR_H + i * ROW_H;
    const setW = row.icons.length * SLOT;
    const copies = Math.ceil(areaW / setW) + 1;
    const leftward = i % 2 === 0;
    const duration = (setW / SPEED).toFixed(1);
    keyframes.push(
      `@keyframes row${i}{from{transform:translateX(${leftward ? 0 : -setW}px)}to{transform:translateX(${leftward ? -setW : 0}px)}}`,
      `.row${i}{animation:row${i} ${duration}s linear infinite}`,
    );

    const items = [];
    for (let c = 0; c < copies; c++) {
      row.icons.forEach(([id, name], k) => {
        const x = c * setW + k * SLOT;
        items.push(
          `<g transform="translate(${x} 0)">` +
            `<use href="#ic-${id}" x="${(SLOT - ICON) / 2}" y="12" width="${ICON}" height="${ICON}"/>` +
            `<text class="name" x="${SLOT / 2}" y="${12 + ICON + 16}">${escapeXml(name)}</text>` +
          `</g>`,
        );
      });
    }

    const separator = i > 0
      ? `<line x1="${PAD}" x2="${WIDTH - PAD}" y1="${y}" y2="${y}" stroke="${t.rule}"/>`
      : "";

    return `
  ${separator}
  <g transform="translate(${PAD} ${y})">
    <rect x="0" y="${ROW_H / 2 - 15}" width="3" height="30" rx="1.5" fill="${t.accent}"/>
    <text class="label" x="14" y="${ROW_H / 2 - 2}">${escapeXml(row.label.toUpperCase())}</text>
    <text class="count" x="14" y="${ROW_H / 2 + 15}">${row.icons.length} tools</text>
  </g>
  <g mask="url(#fade)" transform="translate(0 ${y})">
    <g transform="translate(${areaX} 0)">
      <g class="row${i}">${items.join("")}</g>
    </g>
  </g>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="Tech stack: ${escapeXml(ROWS.flatMap((r) => r.icons.map(([, n]) => n)).join(", "))}">
  <style>
    .label{font:700 12px ${SANS};letter-spacing:.12em;fill:${t.text}}
    .count{font:500 11px ${SANS};fill:${t.muted}}
    .name{font:500 11px ${SANS};fill:${t.muted};text-anchor:middle}
    .prompt{font:500 12px ${MONO};fill:${t.muted}}
    .prompt tspan.accent{fill:${t.accent}}
    .cursor{animation:blink 1.1s steps(1) infinite}
    @keyframes blink{50%{fill-opacity:0}}
    ${keyframes.join("\n    ")}
    @media (prefers-reduced-motion: reduce){[class^="row"],.cursor{animation:none}}
  </style>
  <defs>
    <linearGradient id="fade-edges" x1="0" x2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/>
      <stop offset="${(FADE / areaW).toFixed(3)}" stop-color="#fff"/>
      <stop offset="${(1 - FADE / areaW).toFixed(3)}" stop-color="#fff"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <mask id="fade" maskUnits="userSpaceOnUse" x="0" y="0" width="${WIDTH}" height="${ROW_H}">
      <rect x="${areaX}" y="0" width="${areaW}" height="${ROW_H}" fill="url(#fade-edges)"/>
    </mask>
    ${symbols.join("\n    ")}
  </defs>

  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="12" fill="${t.bg}" stroke="${t.border}"/>
  <path d="M0.5 12.5a12 12 0 0 1 12-12h${WIDTH - 25}a12 12 0 0 1 12 12v${BAR_H - 12}h-${WIDTH - 1}z" fill="${t.bar}"/>
  <line x1="0.5" x2="${WIDTH - 0.5}" y1="${BAR_H + 0.5}" y2="${BAR_H + 0.5}" stroke="${t.border}"/>
  <circle cx="22" cy="${BAR_H / 2}" r="5.5" fill="#ff5f57"/>
  <circle cx="40" cy="${BAR_H / 2}" r="5.5" fill="#febc2e"/>
  <circle cx="58" cy="${BAR_H / 2}" r="5.5" fill="#28c840"/>
  <text class="prompt" x="80" y="${BAR_H / 2 + 4}"><tspan class="accent">dashrat@github</tspan>:~$ ls ./stack <tspan class="accent cursor">█</tspan></text>
  <text class="count" x="${WIDTH - PAD}" y="${BAR_H / 2 + 4}" text-anchor="end">${total} technologies</text>
${rows}
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="12" fill="none" stroke="${t.border}"/>
</svg>
`;
}

for (const name of Object.keys(THEMES)) {
  const out = `assets/tech-stack-${name}.svg`;
  await writeFile(out, await build(name));
  console.log(`wrote ${out}`);
}
