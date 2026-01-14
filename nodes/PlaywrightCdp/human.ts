import type { Page, ElementHandle } from 'playwright-core';
import type { HumanEmulationConfig } from './types';

/**
 * Point in 2D space
 */
interface Point {
	x: number;
	y: number;
}

/**
 * Default configuration values
 */
const DEFAULTS = {
	mouseSpeed: { min: 100, max: 300 }, // px per 100ms
	typingDelay: { min: 50, max: 150 }, // ms between keystrokes
	scrollDelay: { min: 50, max: 100 }, // ms between scroll steps
	moveSteps: 25, // number of mouse movement steps
};

/**
 * Generate random number between min and max
 */
function randomBetween(min: number, max: number): number {
	return Math.random() * (max - min) + min;
}

/**
 * Sleep for a random duration
 */
function randomSleep(min: number, max: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, randomBetween(min, max)));
}

/**
 * Calculate point on cubic bezier curve
 * @param t - Parameter from 0 to 1
 * @param p0 - Start point
 * @param p1 - First control point
 * @param p2 - Second control point
 * @param p3 - End point
 */
function bezierPoint(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
	const t2 = t * t;
	const t3 = t2 * t;
	const mt = 1 - t;
	const mt2 = mt * mt;
	const mt3 = mt2 * mt;

	return {
		x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
		y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
	};
}

/**
 * Generate human-like mouse path using bezier curves
 */
function generateMousePath(start: Point, end: Point, steps: number = DEFAULTS.moveSteps): Point[] {
	const path: Point[] = [];

	// Calculate distance for control point offset
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const distance = Math.sqrt(dx * dx + dy * dy);

	// Generate random control points that create natural curve
	// Control points are offset perpendicular to the line
	const offset1 = randomBetween(0.2, 0.4) * distance;
	const offset2 = randomBetween(0.2, 0.4) * distance;
	const angle1 = randomBetween(-Math.PI / 4, Math.PI / 4);
	const angle2 = randomBetween(-Math.PI / 4, Math.PI / 4);

	const cp1: Point = {
		x: start.x + dx * 0.25 + Math.cos(angle1) * offset1,
		y: start.y + dy * 0.25 + Math.sin(angle1) * offset1,
	};

	const cp2: Point = {
		x: start.x + dx * 0.75 + Math.cos(angle2) * offset2,
		y: start.y + dy * 0.75 + Math.sin(angle2) * offset2,
	};

	// Generate points along the curve
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		// Add slight randomness to each point
		const point = bezierPoint(t, start, cp1, cp2, end);
		path.push({
			x: Math.round(point.x + randomBetween(-1, 1)),
			y: Math.round(point.y + randomBetween(-1, 1)),
		});
	}

	return path;
}

/**
 * Get random point inside element bounding box (not center)
 */
async function getRandomPointInElement(element: ElementHandle): Promise<Point> {
	const box = await element.boundingBox();
	if (!box) {
		throw new Error('Element has no bounding box');
	}

	// Get random point within element, avoiding edges (10% margin)
	const marginX = box.width * 0.1;
	const marginY = box.height * 0.1;

	return {
		x: box.x + marginX + randomBetween(0, box.width - 2 * marginX),
		y: box.y + marginY + randomBetween(0, box.height - 2 * marginY),
	};
}

/**
 * Get current mouse position (or random starting position if unknown)
 */
let lastMousePosition: Point = { x: 100, y: 100 };

/**
 * Move mouse along a path with human-like speed
 */
async function moveMouseAlongPath(page: Page, path: Point[], config: HumanEmulationConfig): Promise<void> {
	const speed = config.mouseSpeed || DEFAULTS.mouseSpeed;

	for (let i = 0; i < path.length; i++) {
		const point = path[i];

		// Calculate delay based on distance to previous point
		if (i > 0) {
			const prev = path[i - 1];
			const dist = Math.sqrt(Math.pow(point.x - prev.x, 2) + Math.pow(point.y - prev.y, 2));
			const delay = (dist / randomBetween(speed.min, speed.max)) * 100;
			await new Promise((resolve) => setTimeout(resolve, Math.max(1, delay)));
		}

		await page.mouse.move(point.x, point.y);
	}

	// Update last known position
	if (path.length > 0) {
		lastMousePosition = path[path.length - 1];
	}
}

/**
 * Human-like click on element
 */
export async function humanClick(
	page: Page,
	selector: string,
	config: HumanEmulationConfig,
	options?: { button?: 'left' | 'right' | 'middle'; clickCount?: number },
): Promise<void> {
	// Find element
	const element = await page.$(selector);
	if (!element) {
		throw new Error(`Element not found: ${selector}`);
	}

	// Get target point inside element
	const targetPoint = await getRandomPointInElement(element);

	// Generate mouse path from current position
	const path = generateMousePath(lastMousePosition, targetPoint);

	// Move mouse along path
	await moveMouseAlongPath(page, path, config);

	// Small pause before click (human hesitation)
	await randomSleep(50, 150);

	// Click
	await page.mouse.click(targetPoint.x, targetPoint.y, {
		button: options?.button || 'left',
		clickCount: options?.clickCount || 1,
	});

	// Small pause after click
	await randomSleep(50, 100);
}

/**
 * Human-like typing
 */
export async function humanType(
	page: Page,
	selector: string,
	text: string,
	config: HumanEmulationConfig,
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	options?: { delay?: number },
): Promise<void> {
	const typingDelay = config.typingDelay || DEFAULTS.typingDelay;

	// Click on element first (human behavior)
	await humanClick(page, selector, config);

	// Small pause before typing
	await randomSleep(100, 200);

	// Type each character with random delay
	for (const char of text) {
		await page.keyboard.type(char);

		// Variable delay between characters
		// Longer delay after punctuation and spaces
		let delay = randomBetween(typingDelay.min, typingDelay.max);
		if (['.', ',', '!', '?', ' ', '\n'].includes(char)) {
			delay *= randomBetween(1.5, 2.5);
		}

		await new Promise((resolve) => setTimeout(resolve, delay));
	}
}

/**
 * Human-like fill (clears field first, then types)
 */
export async function humanFill(
	page: Page,
	selector: string,
	text: string,
	config: HumanEmulationConfig,
): Promise<void> {
	// Click on element
	await humanClick(page, selector, config);

	// Select all and delete (like a human would)
	await page.keyboard.press('Control+a');
	await randomSleep(50, 100);
	await page.keyboard.press('Backspace');
	await randomSleep(100, 200);

	// Type new text
	const typingDelay = config.typingDelay || DEFAULTS.typingDelay;
	for (const char of text) {
		await page.keyboard.type(char);
		let delay = randomBetween(typingDelay.min, typingDelay.max);
		if (['.', ',', '!', '?', ' ', '\n'].includes(char)) {
			delay *= randomBetween(1.5, 2.5);
		}
		await new Promise((resolve) => setTimeout(resolve, delay));
	}
}

/**
 * Human-like scroll
 */
export async function humanScroll(
	page: Page,
	direction: 'up' | 'down',
	amount: number,
	config: HumanEmulationConfig,
): Promise<void> {
	const scrollDelay = config.scrollDelay || DEFAULTS.scrollDelay;
	const scrollDirection = direction === 'down' ? 1 : -1;

	// Break scroll into smaller chunks
	const chunkSize = randomBetween(50, 150);
	const chunks = Math.ceil(amount / chunkSize);

	for (let i = 0; i < chunks; i++) {
		const scrollAmount = Math.min(chunkSize, amount - i * chunkSize);
		await page.mouse.wheel(0, scrollAmount * scrollDirection);
		await randomSleep(scrollDelay.min, scrollDelay.max);
	}
}

/**
 * Create a humanized page wrapper using Proxy
 * Intercepts click, type, fill methods to use human-like versions
 */
export function createHumanizedPage(page: Page, config: HumanEmulationConfig): Page {
	if (!config.enabled) {
		return page;
	}

	const handler: ProxyHandler<Page> = {
		get(target: Page, prop: string | symbol) {
			const value = target[prop as keyof Page];

			// Intercept click
			if (prop === 'click') {
				return async (selector: string, options?: Parameters<Page['click']>[1]) => {
					await humanClick(target, selector, config, options as { button?: 'left' | 'right' | 'middle'; clickCount?: number });
				};
			}

			// Intercept type
			if (prop === 'type') {
				return async (selector: string, text: string, options?: Parameters<Page['type']>[2]) => {
					await humanType(target, selector, text, config, options);
				};
			}

			// Intercept fill
			if (prop === 'fill') {
				return async (selector: string, value: string) => {
					await humanFill(target, selector, value, config);
				};
			}

			// Return bound function or value
			if (typeof value === 'function') {
				return value.bind(target);
			}
			return value;
		},
	};

	return new Proxy(page, handler);
}
