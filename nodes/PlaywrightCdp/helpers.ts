import type { Page, BrowserContext, Route, Request } from 'playwright-core';
import type { IExecuteFunctions, IBinaryData } from 'n8n-workflow';
import type { PlaywrightHelpers, ScreenshotOptions, PdfOptions, DownloadOptions, UploadOptions, UploadFileData } from './types';

/**
 * Creates helper functions for user code execution
 */
export function createHelpers(
	executeFunctions: IExecuteFunctions,
	browserContext: BrowserContext,
): PlaywrightHelpers {
	return {
		/**
		 * Take a screenshot of the page and return as n8n binary data
		 */
		async screenshot(page: Page, options: ScreenshotOptions = {}): Promise<IBinaryData> {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const { binaryPropertyName, ...screenshotOptions } = options;

			const buffer = await page.screenshot({
				type: screenshotOptions.type || 'png',
				fullPage: screenshotOptions.fullPage || false,
				quality: screenshotOptions.quality,
				clip: screenshotOptions.clip,
				omitBackground: screenshotOptions.omitBackground,
			});

			const mimeType = screenshotOptions.type === 'jpeg' ? 'image/jpeg' : 'image/png';
			const extension = screenshotOptions.type === 'jpeg' ? 'jpg' : 'png';

			return executeFunctions.helpers.prepareBinaryData(
				buffer,
				`screenshot_${Date.now()}.${extension}`,
				mimeType,
			);
		},

		/**
		 * Generate PDF from the page and return as n8n binary data
		 * Note: PDF generation only works in headless Chromium
		 */
		async pdf(page: Page, options: PdfOptions = {}): Promise<IBinaryData> {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const { binaryPropertyName, ...pdfOptions } = options;

			try {
				const buffer = await page.pdf({
					format: pdfOptions.format || 'A4',
					landscape: pdfOptions.landscape || false,
					printBackground: pdfOptions.printBackground ?? true,
					scale: pdfOptions.scale,
					margin: pdfOptions.margin,
					pageRanges: pdfOptions.pageRanges,
					headerTemplate: pdfOptions.headerTemplate,
					footerTemplate: pdfOptions.footerTemplate,
				});

				return executeFunctions.helpers.prepareBinaryData(
					buffer,
					`document_${Date.now()}.pdf`,
					'application/pdf',
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (message.includes('headless') || message.includes('Printing')) {
					throw new Error(
						'PDF generation requires headless mode. ' +
							'Most antidetect browsers run in headed mode and do not support PDF generation. ' +
							`Original error: ${message}`,
					);
				}
				throw error;
			}
		},

		/**
		 * Download a file either by URL or by clicking an element
		 */
		async download(source: Page | string, options: DownloadOptions = {}): Promise<IBinaryData> {
			const { timeout = 30000 } = options;

			if (typeof source === 'string') {
				// URL-based download
				const page = await browserContext.newPage();
				try {
					const response = await page.request.get(source, {
						headers: options.headers,
						timeout,
					});

					const buffer = await response.body();
					const contentType = response.headers()['content-type'] || 'application/octet-stream';
					const contentDisposition = response.headers()['content-disposition'] || '';

					// Extract filename from Content-Disposition or URL
					let fileName = 'downloaded_file';
					const filenameMatch = contentDisposition.match(
						/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/,
					);
					if (filenameMatch) {
						fileName = filenameMatch[1].replace(/['"]/g, '');
					} else {
						try {
							const urlPath = new URL(source).pathname;
							const urlFileName = urlPath.split('/').pop();
							if (urlFileName && urlFileName.includes('.')) {
								fileName = urlFileName;
							}
						} catch {
							// Keep default filename if URL parsing fails
						}
					}

					return executeFunctions.helpers.prepareBinaryData(buffer, fileName, contentType);
				} finally {
					await page.close();
				}
			} else {
				// Click-based download
				const page = source;
				const { clickSelector } = options;

				if (!clickSelector) {
					throw new Error(
						'clickSelector is required when source is a Page. ' +
							'Use $helpers.download(url) for direct URL downloads.',
					);
				}

				const [download] = await Promise.all([
					page.waitForEvent('download', { timeout }),
					page.click(clickSelector),
				]);

				// Always use createReadStream for CDP connections
				// because downloads happen on remote browser, not locally
				const stream = await download.createReadStream();
				if (!stream) {
					throw new Error('Failed to get download stream. The download may have failed.');
				}

				const chunks: Buffer[] = [];
				for await (const chunk of stream) {
					chunks.push(Buffer.from(chunk));
				}
				const buffer = Buffer.concat(chunks);

				const fileName = download.suggestedFilename() || 'downloaded_file';

				return executeFunctions.helpers.prepareBinaryData(
					buffer,
					fileName,
					'application/octet-stream',
				);
			}
		},

		/**
		 * Convert n8n binary data to upload file format
		 * Use this to prepare files from previous nodes for upload
		 * @param binaryPropertyName - name of the binary property (e.g., 'data', 'attachment')
		 * @param itemIndex - optional item index, defaults to current item
		 */
		async binaryToFile(binaryPropertyName: string, itemIndex?: number): Promise<UploadFileData> {
			const idx = itemIndex ?? 0;
			const buffer = await executeFunctions.helpers.getBinaryDataBuffer(idx, binaryPropertyName);
			const binaryData = executeFunctions.getInputData()[idx]?.binary?.[binaryPropertyName];

			return {
				name: binaryData?.fileName || 'file',
				mimeType: binaryData?.mimeType || 'application/octet-stream',
				buffer,
			};
		},

		/**
		 * Upload file(s) to a page using DataTransfer API
		 * Works with CDP connections (unlike setInputFiles which requires local file access)
		 */
		async upload(
			page: Page,
			files: UploadFileData | UploadFileData[],
			options: UploadOptions,
		): Promise<void> {
			const { selector, clickSelector, timeout = 30000 } = options;
			const fileArray = Array.isArray(files) ? files : [files];

			// Prepare files data for browser context
			const filesData = fileArray.map((file) => ({
				name: file.name,
				mimeType: file.mimeType,
				// Convert Buffer to base64 for transfer to browser
				base64: file.buffer.toString('base64'),
			}));

			if (selector) {
				// Use DataTransfer API (works over CDP)
				// Function runs in browser context, not Node.js
				const uploadScript = `
					(args) => {
						const { sel, filesInfo } = args;
						const input = document.querySelector(sel);
						if (!input) {
							throw new Error('Element not found: ' + sel);
						}

						const dt = new DataTransfer();
						for (const fileInfo of filesInfo) {
							const binary = atob(fileInfo.base64);
							const bytes = new Uint8Array(binary.length);
							for (let i = 0; i < binary.length; i++) {
								bytes[i] = binary.charCodeAt(i);
							}
							const file = new File([bytes], fileInfo.name, { type: fileInfo.mimeType });
							dt.items.add(file);
						}

						input.files = dt.files;
						input.dispatchEvent(new Event('change', { bubbles: true }));
						input.dispatchEvent(new Event('input', { bubbles: true }));
					}
				`;
				const fn = new Function('return ' + uploadScript)();
				await page.evaluate(fn, { sel: selector, filesInfo: filesData });
			} else if (clickSelector) {
				// File chooser dialog - still need setInputFiles for this
				// This may not work over CDP, but we try anyway
				const [fileChooser] = await Promise.all([
					page.waitForEvent('filechooser', { timeout }),
					page.click(clickSelector),
				]);
				const playwrightFiles = fileArray.map((file) => ({
					name: file.name,
					mimeType: file.mimeType,
					buffer: file.buffer,
				}));
				await fileChooser.setFiles(playwrightFiles);
			} else {
				throw new Error(
					'Either selector or clickSelector must be provided. ' +
						'Use selector for input[type="file"] elements, ' +
						'or clickSelector to trigger a file chooser dialog.',
				);
			}
		},

		/**
		 * Set up request interception on a page
		 */
		async interceptRequests(
			page: Page,
			urlPattern: string | RegExp,
			handler: (route: Route, request: Request) => Promise<void> | void,
		): Promise<void> {
			await page.route(urlPattern, handler);
		},

		/**
		 * Get full page snapshot (like Playwright MCP)
		 * Includes: URL, title, and accessibility tree
		 */
		async snapshot(page: Page): Promise<string> {
			const lines: string[] = [];

			// 1. Page metadata
			lines.push('### Page');
			lines.push(`- URL: ${page.url()}`);
			try {
				lines.push(`- Title: ${await page.title()}`);
			} catch {
				lines.push('- Title: (unavailable)');
			}
			lines.push('');

			// 2. Accessibility tree (ARIA snapshot)
			lines.push('### Accessibility Tree');
			try {
				const aria = await page.locator('body').ariaSnapshot();
				lines.push(aria || '(empty)');
			} catch {
				lines.push('(not available - page may not be loaded)');
			}

			return lines.join('\n');
		},
	};
}
