import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { transform } from 'lightningcss';

const input = new URL('../src/styles/styles.css', import.meta.url);
const output = new URL('../public/styles.css', import.meta.url);
const inlineOutput = new URL('../src/styles/styles-inline.ts', import.meta.url);

async function build() {
  const source = await readFile(input, 'utf8');
  const result = await postcss([tailwindcss()]).process(source, {
    from: fileURLToPath(input),
    map: false,
  });
  const css = transform({
    filename: fileURLToPath(output),
    code: Buffer.from(result.css),
    minify: true,
  }).code.toString();

  await writeIfChanged(output, css);
  const escaped = css.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  await writeIfChanged(inlineOutput, `export const STYLES_CSS = \`${escaped}\`;\n`);
  console.log(`Generated ${fileURLToPath(output)} and ${fileURLToPath(inlineOutput)}`);
}

async function writeIfChanged(file, content) {
  const previous = await readFile(file, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (previous !== content) await writeFile(file, content);
}

await build();

if (process.argv.includes('--watch')) {
  const sourceRoot = new URL('../src/', import.meta.url);
  async function snapshot() {
    const files = (await readdir(sourceRoot, { recursive: true }))
      .filter((file) => /\.(?:css|ts|js)$/.test(file) && file !== 'styles/styles-inline.ts')
      .sort();
    return (await Promise.all(files.map(async (file) => {
      const details = await stat(new URL(file, sourceRoot));
      return `${file}:${details.mtimeMs}:${details.size}`;
    }))).join('|');
  }

  let previous = await snapshot();
  let checking = false;
  setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const current = await snapshot();
      if (current !== previous) {
        previous = current;
        await build();
      }
    } catch (error) {
      console.error('CSS watch failed:', error);
    } finally {
      checking = false;
    }
  }, 500);
  console.log('Watching src/ for CSS changes');
}
