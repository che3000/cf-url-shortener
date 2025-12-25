import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const input = new URL('../public/styles.css', import.meta.url);
const output = new URL('../src/styles/styles-inline.ts', import.meta.url);

async function ensureDir(fileUrl) {
    const dir = dirname(fileUrl.pathname);
    await mkdir(dir, { recursive: true }).catch(() => { });
}

(async () => {
    try {
        const css = await readFile(input, 'utf-8');
        // Escape backslashes first, then backticks, and template placeholders
        const escaped = css
            .replace(/\\/g, "\\\\")
            .replace(/`/g, "\\`")
            .replace(/\$\{/g, "\\${");

        const content = `export const STYLES_CSS = \`${escaped}\`;\n`;

        await ensureDir(output);
        await writeFile(output, content, 'utf-8');
        console.log('Generated src/styles/styles-inline.ts');
    } catch (err) {
        console.error('Failed to generate inline CSS:', err);
        process.exit(1);
    }
})();
