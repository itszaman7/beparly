const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  globalIgnores(['dist*/*']),
  expoConfig,
  {
    settings: { 'import/resolver': { typescript: { project: './tsconfig.json' }, node: true } },
  },
  { files: ['src/components/animated-icon.tsx'], rules: { 'import/namespace': 'off' } },
]);
