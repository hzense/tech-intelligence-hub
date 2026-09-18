import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

// Real components/styles, synthetic data only; no production services or writes.
export async function startAdminControlsFixture() {
  const web = fileURLToPath(new URL('../../../', import.meta.url));
  const compiled = await build({
    stdin: {
      contents: `
        import {createRoot} from 'react-dom/client';
        import {AdminImports} from './components/admin-imports';
        import {AdminSignalGeneration} from './components/admin-signal-generation';
        import {AdminGenerationPreflight} from './components/admin-generation-preflight';
        import {AdminSignalWorkbenchList, AdminSignalWorkbenchDetail} from './components/admin-signal-workbench';
        import {AdminPublicationForm} from './components/admin-publication-form';
        import {AiNavigation} from './components/admin-ai-shared';
        import {GoogleSignInButton, AdminSignOutButton} from './components/admin-auth-buttons';
        import auth from './components/admin-auth.module.css';
        const pages = {
          '/imports': <AdminImports configured={false}/>,
          '/generation': <AdminSignalGeneration configured={false}/>,
          '/preflight': <AdminGenerationPreflight/>,
          '/signals': <AdminSignalWorkbenchList state={{status:'ready', data:{items:[], next_after:'next'}}} query="test" after="previous" publicReadEnabled={false}/>,
          '/signal-detail': <AdminSignalWorkbenchDetail state={{status:'not_found'}} publicReadEnabled={false}/>,
          '/ai': <AiNavigation/>,
          '/auth': <div className={auth.actions}><GoogleSignInButton disabled/><AdminSignOutButton/><a className={auth.backLink} href="/">返回网站</a><a className={auth.backLink} href="/admin/imports">文档与链接批量导入</a></div>,
          '/publication': <AdminPublicationForm configured={false} databaseMode={false}/>
        };
        createRoot(document.getElementById('root')).render(pages[location.pathname] ?? <p>导航已到达</p>);
      `,
      resolveDir: web,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    outfile: '/fixture/entry.js',
    platform: 'browser',
    format: 'esm',
    jsx: 'automatic',
    define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  const assets = new Map(
    compiled.outputFiles.map((f) => [`/${f.path.split('/').at(-1)}`, f.contents]),
  );
  assets.set(
    '/preflight.css',
    await readFile(fileURLToPath(import.meta.resolve('tailwindcss/preflight.css'))),
  );
  const globals = await readFile(new URL('../../../app/globals.css', import.meta.url), 'utf8');
  assets.set('/globals.css', globals.replace(/^@import\s+['"]tailwindcss['"];\s*/m, ''));
  const writes = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET') {
      writes.push({ method: req.method, path: url.pathname });
      res.writeHead(405).end();
      return;
    }
    if (assets.has(url.pathname)) {
      res.setHeader('Content-Type', url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
      res.end(assets.get(url.pathname));
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(
      `<!doctype html><html lang="zh" data-theme="${url.searchParams.get('theme') === 'dark' ? 'dark' : 'light'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/preflight.css"><link rel="stylesheet" href="/globals.css"><link rel="stylesheet" href="/entry.css"><div id="root"></div><script type="module" src="/entry.js"></script></html>`,
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    writes,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
