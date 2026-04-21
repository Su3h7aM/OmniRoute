import { URL } from "url";

type LocalServerHandle = {
	server: unknown;
	port: number;
	close: () => void;
};

const CALLBACK_PATHS = new Set(["/callback", "/auth/callback"]);
const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authentication Successful</title>
  <style>
    body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .success { color: #22c55e; font-size: 3rem; }
    h1 { margin: 1rem 0; }
    p { color: #666; }
    #countdown { font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <div class="success">&#10003;</div>
    <h1>Authentication Successful</h1>
    <p id="message">Closing in <span id="countdown">3</span> seconds...</p>
  </div>
  <script>
    let count = 3;
    const countdown = document.getElementById("countdown");
    const message = document.getElementById("message");
    const timer = setInterval(() => {
      count--;
      countdown.textContent = count;
      if (count <= 0) {
        clearInterval(timer);
        window.close();
        setTimeout(() => {
          message.textContent = "Please close this tab manually.";
        }, 500);
      }
    }, 1000);
  </script>
</body>
</html>`;

function buildCallbackResponse(url: URL, onCallback: (params: Record<string, string>) => void) {
	if (!CALLBACK_PATHS.has(url.pathname)) {
		return new Response("Not found", { status: 404 });
	}

	const params = Object.fromEntries(url.searchParams);
	onCallback(params);
	return new Response(SUCCESS_HTML, {
		status: 200,
		headers: { "Content-Type": "text/html; charset=utf-8" },
	});
}

function createLocalServerHandle(
	onCallback: (params: Record<string, string>) => void,
	fixedPort: number | null
): LocalServerHandle {
	const server = Bun.serve({
		port: fixedPort || 0,
		hostname: "127.0.0.1",
		fetch(request) {
			return buildCallbackResponse(new URL(request.url), onCallback);
		},
	});

	return {
		server,
		port: server.port,
		close: () => {
			server.stop(true);
		},
	};
}

/**
 * Start a local HTTP server to receive OAuth callback
 */
export function startLocalServer(
	onCallback: (params: Record<string, string>) => void,
	fixedPort: number | null = null
): Promise<LocalServerHandle> {
	return Promise.resolve(createLocalServerHandle(onCallback, fixedPort));
}

/**
 * Wait for callback with timeout
 */
export function waitForCallback(timeoutMs = 300000) {
	return new Promise((resolve, reject) => {
		let resolved = false;

		const timeout = setTimeout(() => {
			if (!resolved) {
				resolved = true;
				reject(new Error("Authentication timeout"));
			}
		}, timeoutMs);

		const onCallback = (params: Record<string, string>) => {
			if (!resolved) {
				resolved = true;
				clearTimeout(timeout);
				resolve(params);
			}
		};

		(resolve as { __onCallback?: typeof onCallback }).__onCallback = onCallback;
	});
}
