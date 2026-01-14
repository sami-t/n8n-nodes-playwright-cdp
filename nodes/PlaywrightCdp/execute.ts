import type { IBinaryData, IDataObject } from 'n8n-workflow';
import type { UserCodeResult, ExecutionSandbox } from './types';

/**
 * Formatted error with line information
 */
interface FormattedError {
	message: string;
	lineNumber?: number;
	codeSnippet?: string;
}

/**
 * Extract line number and create code snippet from error
 */
function formatUserCodeError(error: Error, userCode: string): FormattedError {
	const stack = error.stack || '';

	// Try to extract line number from stack trace
	// Patterns: "user-code.js:LINE:COL" or "<anonymous>:LINE:COL"
	const lineMatch =
		stack.match(/user-code\.js:(\d+):\d+/) || stack.match(/<anonymous>:(\d+):\d+/);

	const result: FormattedError = {
		message: error.message,
	};

	if (lineMatch) {
		const lineNumber = parseInt(lineMatch[1], 10);
		result.lineNumber = lineNumber;

		// Generate code snippet with context (3 lines)
		const lines = userCode.split('\n');
		const startLine = Math.max(0, lineNumber - 2);
		const endLine = Math.min(lines.length, lineNumber + 1);

		const snippet = lines
			.slice(startLine, endLine)
			.map((line, idx) => {
				const actualLine = startLine + idx + 1;
				const marker = actualLine === lineNumber ? '>>> ' : '    ';
				return `${marker}${actualLine}: ${line}`;
			})
			.join('\n');

		result.codeSnippet = snippet;
	}

	return result;
}

/**
 * Execute user code with sandbox variables and timeout
 */
export async function executeUserCode(
	code: string,
	sandbox: ExecutionSandbox,
	timeout: number,
): Promise<UserCodeResult> {
	// Create async function constructor

	const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

	// Build function with sandbox variables as parameters
	const paramNames = Object.keys(sandbox);
	const paramValues = Object.values(sandbox);

	// Wrap code with strict mode and source URL for debugging
	const wrappedCode = `
		"use strict";
		${code}
		//# sourceURL=user-code.js
	`;

	// Create the function
	let userFunction: (...args: unknown[]) => Promise<UserCodeResult>;
	try {
		userFunction = new AsyncFunction(...paramNames, wrappedCode) as (
			...args: unknown[]
		) => Promise<UserCodeResult>;
	} catch (syntaxError) {
		throw new Error(`Syntax error in code: ${(syntaxError as Error).message}`);
	}

	// Execute with timeout
	const executePromise = userFunction(...paramValues);

	if (timeout <= 0) {
		// No timeout
		return executePromise;
	}

	// Race between execution and timeout
	const timeoutPromise = new Promise<never>((_, reject) => {
		setTimeout(() => {
			reject(new Error(`Execution timeout exceeded (${timeout}ms)`));
		}, timeout);
	});

	try {
		return await Promise.race([executePromise, timeoutPromise]);
	} catch (error) {
		if (error instanceof Error) {
			// Check if it's a timeout error (pass through as-is)
			if (error.message.includes('timeout exceeded')) {
				throw error;
			}

			// Format user code errors with line numbers
			const formatted = formatUserCodeError(error, code);

			let errorMessage = `Error in user code: ${formatted.message}`;
			if (formatted.lineNumber) {
				errorMessage += `\n\nAt line ${formatted.lineNumber}:`;
			}
			if (formatted.codeSnippet) {
				errorMessage += `\n${formatted.codeSnippet}`;
			}

			throw new Error(errorMessage);
		}
		throw error;
	}
}

/**
 * Normalize user code result to n8n format
 */
export function normalizeResult(
	result: UserCodeResult,
): Array<{ json: IDataObject; binary?: Record<string, IBinaryData> }> {
	if (result === undefined || result === null) {
		return [{ json: {} }];
	}

	// Array of items
	if (Array.isArray(result)) {
		return result.map((item) => {
			if (
				typeof item === 'object' &&
				item !== null &&
				('json' in item || 'binary' in item)
			) {
				return {
					json: (item.json || {}) as IDataObject,
					binary: item.binary as Record<string, IBinaryData> | undefined,
				};
			}
			return { json: item as IDataObject };
		});
	}

	// Object with json/binary structure
	if (
		typeof result === 'object' &&
		result !== null &&
		('json' in result || 'binary' in result)
	) {
		return [
			{
				json: ((result as { json?: Record<string, unknown> }).json || {}) as IDataObject,
				binary: (result as { binary?: Record<string, IBinaryData> }).binary,
			},
		];
	}

	// Plain object - treat as json
	return [{ json: result as IDataObject }];
}
