# n8n-nodes-playwright-cdp

Execute Playwright code in n8n by connecting to browsers via Chrome DevTools Protocol (CDP).

Perfect for:
- Connecting to antidetect browsers (Dolphin Anty, AdsPower, GoLogin, etc.)
- Browser automation with existing browser sessions
- Web scraping with stealth capabilities

## Installation

### Community Nodes (Recommended)

1. Go to **Settings > Community Nodes**
2. Select **Install**
3. Enter `@oneassasin/n8n-nodes-playwright-cdp`
4. Agree to the risks and click **Install**

### Manual Installation

```bash
npm install @oneassasin/n8n-nodes-playwright-cdp
```

## Usage

### 1. Get CDP Endpoint

Start your browser with remote debugging enabled or get the CDP URL from your antidetect browser:

**Chrome/Chromium:**
```bash
google-chrome --remote-debugging-port=9222
```

**Antidetect browsers:**
- Dolphin Anty: Profile settings → Get CDP URL
- AdsPower: Local API → Get debug port
- GoLogin: Profile → Remote debugging

### 2. Configure Node

- **CDP Endpoint URL**: Your browser's CDP endpoint (e.g., `ws://localhost:9222/devtools/browser/...`)
- **JavaScript Code**: Your Playwright automation code
- **Emulate Human Behavior**: Enable human-like mouse movements and typing
- **Options**: Connection/execution timeouts

### 3. Write Code

Available variables in your code:

| Variable | Description |
|----------|-------------|
| `$playwright` | Playwright library |
| `$browser` | Connected browser instance |
| `$context` | Browser context |
| `$helpers` | Helper functions (see below) |
| `$input` | Input data from previous node |
| `$json` | Shortcut for `$input.item.json` |
| `$binary` | Binary data from previous node |
| `$humanized` | `true` if human emulation enabled |

## Helper Functions

### Screenshot
```javascript
const page = await $context.newPage();
await page.goto('https://example.com');

const screenshot = await $helpers.screenshot(page, {
  fullPage: true,
  type: 'png'
});

return { binary: { screenshot } };
```

### PDF Generation
```javascript
const page = await $context.newPage();
await page.goto('https://example.com');

const pdf = await $helpers.pdf(page, {
  format: 'A4',
  printBackground: true
});

return { binary: { document: pdf } };
```

### Download File
```javascript
// By URL
const file = await $helpers.download('https://example.com/file.pdf');

// By clicking element
const page = await $context.newPage();
await page.goto('https://example.com');
const file = await $helpers.download(page, {
  clickSelector: '#download-btn'
});

return { binary: { file } };
```

### Upload File
```javascript
const page = await $context.newPage();
await page.goto('https://example.com/upload');

// Get file from previous node
const file = await $helpers.binaryToFile('data');

// Upload to input[type="file"]
await $helpers.upload(page, file, {
  selector: '#file-input'
});
```

### Request Interception
```javascript
const page = await $context.newPage();

// Intercept and modify requests
await $helpers.interceptRequests(page, '**/api/**', async (route, request) => {
  // Block request
  // await route.abort();

  // Modify and continue
  await route.continue({
    headers: { ...request.headers(), 'X-Custom': 'value' }
  });
});

await page.goto('https://example.com');
```

### Page Snapshot
```javascript
const page = await $context.newPage();
await page.goto('https://example.com');

// Get accessibility tree (like Playwright MCP)
const snapshot = await $helpers.snapshot(page);

return { snapshot };
```

Output:
```
### Page
- URL: https://example.com
- Title: Example Domain

### Accessibility Tree
- heading "Example Domain"
- paragraph "This domain is for use in illustrative examples..."
- link "More information..."
```

## Human Emulation

When **Emulate Human Behavior** is enabled:

- `page.click()` moves mouse along bezier curves to target
- `page.type()` / `page.fill()` types with random delays between keystrokes
- Clicks target random points within elements, not center

```javascript
// With human emulation enabled:
const page = await $context.newPage();
await page.goto('https://example.com');

// This click will have human-like mouse movement
await page.click('#login-button');

// This will type with realistic delays
await page.type('#username', 'user@example.com');
```

## Examples

### Basic Navigation
```javascript
const page = await $context.newPage();
await page.goto('https://example.com');

const title = await page.title();
const content = await page.textContent('h1');

await page.close();
return { title, content };
```

### Form Submission
```javascript
const page = await $context.newPage();
await page.goto('https://example.com/login');

await page.fill('#email', 'user@example.com');
await page.fill('#password', 'secret');
await page.click('button[type="submit"]');

await page.waitForURL('**/dashboard');
const welcomeText = await page.textContent('.welcome');

await page.close();
return { welcomeText };
```

### Scraping with Multiple Pages
```javascript
const results = [];

for (const url of $json.urls) {
  const page = await $context.newPage();
  await page.goto(url);

  const data = await page.evaluate(() => ({
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content
  }));

  results.push(data);
  await page.close();
}

return results.map(item => ({ json: item }));
```

## Compatibility

Tested with:
- Dolphin Anty
- AdsPower
- GoLogin
- Multilogin
- Regular Chrome/Chromium with `--remote-debugging-port`

## Troubleshooting

### Connection Failed
- Verify browser is running and CDP port is accessible
- Check firewall settings
- For Docker: use `host.docker.internal` instead of `localhost`

### Timeout Errors
- Increase timeouts in Options
- Check network connectivity to target sites

### Human Emulation Not Working
- Ensure checkbox is enabled before execution
- Only affects pages created via `$context.newPage()`

## License

[MIT](LICENSE.md)
