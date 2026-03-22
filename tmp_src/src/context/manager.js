import fs from 'fs-extra';
import path from 'path';
import { DEFAULT_CONFIG } from './schema.js';

export class ContextManager {
  static CONFIG_FILE = 'iterforge.json';

  /**
   * Reads the iterforge.json from the current directory.
   * If it doesn't exist, it returns null.
   */
  static async read() {
    const configPath = path.join(process.cwd(), this.CONFIG_FILE);
    if (!(await fs.pathExists(configPath))) {
      return null;
    }
    return await fs.readJson(configPath);
  }

  /**
   * Initializes a new iterforge.json with default values.
   */
  static async init(projectName = 'new-project') {
    const config = { ...DEFAULT_CONFIG };
    config.project.name = projectName;
    await this.write(config);
    return config;
  }

  /**
   * Atomically writes the config to iterforge.json.
   */
  static async write(config) {
    const configPath = path.join(process.cwd(), this.CONFIG_FILE);
    const tmpPath = `${configPath}.tmp`;
    
    await fs.writeJson(tmpPath, config, { spaces: 2 });
    await fs.move(tmpPath, configPath, { overwrite: true });
  }

  /**
   * Updates specific fields in the config.
   * Supports dot-notation (e.g., 'active.faction')
   */
  static async update(updates) {
    const config = await this.read();
    if (!config) throw new Error('Project not initialized. Run "iterforge init" first.');

    for (const [key, value] of Object.entries(updates)) {
      const parts = key.split('.');
      let current = config;
      for (let i = 0; i < parts.length - 1; i++) {
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = value;
    }

    await this.write(config);
    return config;
  }
}
