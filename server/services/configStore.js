import fs from 'fs';
import path from 'path';

function createConfigStore({ configPath }) {
  function load() {
    try {
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
    } catch {}
    return {
      ai_provider: 'openai',
      file_parser: { provider: 'local' },
    };
  }

  function save(config) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  function get(key) {
    const config = load();
    return key ? config[key] : config;
  }

  function set(key, value) {
    const config = load();
    config[key] = value;
    save(config);
  }

  return { get, set, load, save };
}

export { createConfigStore };