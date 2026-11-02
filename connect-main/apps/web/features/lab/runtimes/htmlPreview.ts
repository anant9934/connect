/**
 * htmlPreview.ts
 * Generates an isolated, sandboxed HTML document string with an injected
 * console logger bridging iframe output to the parent window.
 */

export interface HtmlBundle {
  html: string;
  css: string;
  javascript: string;
}

export function buildSandboxedHtmlDoc(bundle: HtmlBundle): string {
  const { html, css, javascript } = bundle;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
  <style>
    /* Default resets */
    *, *::before, *::after {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #17151F;
      background-color: #FFFFFF;
      line-height: 1.5;
    }
    ${css || ''}
  </style>
</head>
<body>
  ${html || '<div style="color: #6B675C; font-style: italic;">HTML body is empty</div>'}

  <script>
    (function() {
      // Intercept console messages
      const originalLog = console.log;
      const originalError = console.error;
      const originalWarn = console.warn;
      const originalInfo = console.info;

      function sendToParent(type, args) {
        try {
          const messages = Array.from(args).map(arg => {
            if (typeof arg === 'object') {
              try { return JSON.stringify(arg, null, 2); } catch(e) { return String(arg); }
            }
            return String(arg);
          });
          window.parent.postMessage({
            type: 'CONNECT_LAB_CONSOLE',
            level: type,
            text: messages.join(' '),
            timestamp: Date.now()
          }, '*');
        } catch (e) {
          // ignore postMessage errors
        }
      }

      console.log = function() {
        sendToParent('log', arguments);
        originalLog.apply(console, arguments);
      };
      console.error = function() {
        sendToParent('error', arguments);
        originalError.apply(console, arguments);
      };
      console.warn = function() {
        sendToParent('warn', arguments);
        originalWarn.apply(console, arguments);
      };
      console.info = function() {
        sendToParent('info', arguments);
        originalInfo.apply(console, arguments);
      };

      // Catch uncaught errors
      window.onerror = function(message, source, lineno, colno, error) {
        sendToParent('error', ['Error: ' + message + (lineno ? ' (line ' + lineno + ')' : '')]);
      };
    })();

    try {
      ${javascript || ''}
    } catch(err) {
      console.error(err.message || String(err));
    }
  </script>
</body>
</html>`;
}
