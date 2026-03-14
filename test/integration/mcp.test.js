import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '../../bin/iterforge.js');

function mcpCall(proc, method, params, id) {
  return new Promise((resolve, reject) => {
    const req = JSON.stringify({ jsonrpc: '2.0', method, params, id }) + '\n';
    let buf = '';
    const onData = (chunk) => {
      buf += chunk;
      try {
        const parsed = JSON.parse(buf);
        if (parsed.id === id) { proc.stdout.off('data', onData); resolve(parsed); }
      } catch {}
    };
    proc.stdout.on('data', onData);
    proc.on('error', reject);
    proc.stdin.write(req);
    setTimeout(() => reject(new Error('MCP call timeout: ' + method)), 5000);
  });
}

async function test() {
  const tmpDir = path.join(os.tmpdir(), 'iterforge-mcp-test-' + Date.now());
  await fs.ensureDir(tmpDir);
  await fs.writeJson(path.join(tmpDir, 'iterforge.json'), {
    version: '1.0',
    project: { name: 'mcp-test', type: 'godot', godot_version: '4.2', godot_path: './', assets_path: './assets/iterforge/' },
    active: { faction: 'AEGIS', card: null, arena_variant: 'midday-standard', generation_mode: 'base' },
    settings: { zoom: 4, darkness: 3, noise: 1, atmosphere: 'midday', condition: 'standard', width: 1024, height: 1024, steps: 30, cfg: 7.0, auto_start_backends: false },
    backend_override: null,
    last_generated: { image_path: null, prompt: null, backend_used: null, seed: null },
    history: [{ image_path: '/test/img.png', prompt: 'test', backend_used: 'comfyui', seed: 1, timestamp: new Date().toISOString() }],
    max_history: 50, godot_sync: { last_import: null, pending_assets: [] }, iteration_notes: []
  });

  const proc = spawn('node', [CLI, 'mcp'], { cwd: tmpDir, stdio: ['pipe', 'pipe', 'pipe'] });

  try {
    // tools/list returns all 5 tools
    const listResp = await mcpCall(proc, 'tools/list', {}, 1);
    const names = (listResp.result?.tools ?? []).map(t => t.name);
    for (const n of ['generate_asset','read_project_context','write_project_context','get_generation_history','get_backend_status']) {
      if (!names.includes(n)) throw new Error('tools/list: missing ' + n);
    }

    // read_project_context
    const readResp = await mcpCall(proc, 'tools/call', { name: 'read_project_context', arguments: {} }, 2);
    const readResult = JSON.parse(readResp.result.content[0].text);
    if (!readResult.success) throw new Error('read_project_context: failure');
    if (readResult.context.project.name !== 'mcp-test') throw new Error('read_project_context: wrong name');

    // get_generation_history
    const histResp = await mcpCall(proc, 'tools/call', { name: 'get_generation_history', arguments: { n: 5 } }, 3);
    const histResult = JSON.parse(histResp.result.content[0].text);
    if (!Array.isArray(histResult.history)) throw new Error('get_generation_history: not array');
    if (histResult.history.length !== 1) throw new Error('get_generation_history: wrong count');

    // get_backend_status
    const statusResp = await mcpCall(proc, 'tools/call', { name: 'get_backend_status', arguments: {} }, 4);
    const statusResult = JSON.parse(statusResp.result.content[0].text);
    if (!Array.isArray(statusResult.available)) throw new Error('get_backend_status: missing available');
    if (!statusResult.tier) throw new Error('get_backend_status: missing tier');

    // write_project_context patches disk
    const writeResp = await mcpCall(proc, 'tools/call', { name: 'write_project_context', arguments: { updates: { 'active.faction': 'ECLIPSE' } } }, 5);
    const writeResult = JSON.parse(writeResp.result.content[0].text);
    if (!writeResult.success) throw new Error('write_project_context: failure');
    const updated = await fs.readJson(path.join(tmpDir, 'iterforge.json'));
    if (updated.active.faction !== 'ECLIPSE') throw new Error('write_project_context: not on disk');

  } finally {
    proc.kill();
    await new Promise(r => setTimeout(r, 300));
    await fs.remove(tmpDir).catch(() => {});
  }
}

export default test;
