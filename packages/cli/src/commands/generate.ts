import { command, positional, string, optional } from 'cmd-ts';

export const generateCommand = command({
  name: 'generate',
  description: 'Generate/update type annotations (coming in v1.1)',
  args: {
    pattern: positional({ type: optional(string), displayName: 'glob' }),
  },
  async handler() {
    console.error('ts-sqlx generate is not yet implemented. Use the LSP code actions in your editor for now.');
    process.exit(2);
  },
});
