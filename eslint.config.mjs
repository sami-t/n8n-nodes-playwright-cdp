import { config } from '@n8n/node-cli/eslint';

export default [
	...config,
	{
		// This node is designed for self-hosted n8n only (for antidetect browsers)
		// Disable cloud-specific restrictions
		rules: {
			'@n8n/community-nodes/no-restricted-imports': 'off',
			'@n8n/community-nodes/no-restricted-globals': 'off',
		},
	},
];
