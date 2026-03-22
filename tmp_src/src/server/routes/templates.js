import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { ITERFORGE_HOME } from '../../env/reader.js';

const router = express.Router();
const TEMPLATES_FILE = path.join(ITERFORGE_HOME, 'templates.json');

async function readTemplates() {
  if (!(await fs.pathExists(TEMPLATES_FILE))) return [];
  try { return await fs.readJson(TEMPLATES_FILE); } catch { return []; }
}

async function writeTemplates(list) {
  await fs.ensureDir(ITERFORGE_HOME);
  await fs.writeJson(TEMPLATES_FILE, list, { spaces: 2 });
}

// GET /api/templates
router.get('/', async (_req, res) => {
  try {
    const templates = await readTemplates();
    res.json({ templates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/templates
router.post('/', async (req, res) => {
  try {
    const { name, description = '', prompt, negativePrompt = '', defaultModel = null,
            defaultSteps = 30, defaultCfg = 7, defaultSampler = null,
            defaultResolution = '1024x1024' } = req.body;

    if (!name || !prompt) {
      return res.status(400).json({ error: 'name and prompt are required' });
    }

    const templates = await readTemplates();
    const id = `template-${Date.now()}`;
    const newTemplate = {
      id, name, description, prompt, negativePrompt, defaultModel,
      defaultSteps, defaultCfg, defaultSampler, defaultResolution,
      createdAt: new Date().toISOString()
    };
    templates.unshift(newTemplate);
    await writeTemplates(templates);
    res.json({ success: true, templateId: id, template: newTemplate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/templates/:id
router.put('/:id', async (req, res) => {
  try {
    const templates = await readTemplates();
    const idx = templates.findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Template not found' });
    templates[idx] = { ...templates[idx], ...req.body, id: req.params.id };
    await writeTemplates(templates);
    res.json({ success: true, template: templates[idx] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/templates/:id
router.delete('/:id', async (req, res) => {
  try {
    const templates = await readTemplates();
    const filtered = templates.filter(t => t.id !== req.params.id);
    if (filtered.length === templates.length) {
      return res.status(404).json({ error: 'Template not found' });
    }
    await writeTemplates(filtered);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
