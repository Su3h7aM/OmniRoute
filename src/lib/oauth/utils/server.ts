import http from "http";
import { URL } from "url";

type LocalServerHandle = {
	server: unknown;
	port: number;
	close: () => void;
};

const isBunRuntime = typeof Bun !== "undefined";
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

function startLocalServerWithBun(
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

function startLocalServerWithNode(
	onCallback: (params: Record<string, string>) => void,
	fixedPort: number | null
): Promise<LocalServerHandle> {
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			const response = buildCallbackResponse(
				new URL(req.url || "/", "http://localhost"),
				onCallback
			);
			res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
			response
				.text()
				.then((body) => res.end(body))
				.catch((error) => {
					res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
					res.end(String(error instanceof Error ? error.message : error));
				});
		});

		const portToUse = fixedPort || 0;
		server.listen(portToUse, "127.0.0.1", () => {
			const addr = server.address() as { port: number };
			resolve({
				server,
				port: addr.port,
				close: () => server.close(),
			});
		});

		server.on("error", (err: NodeJS.ErrnoException) => {
			if (err.code === "EADDRINUSE" && fixedPort) {
				reject(
					new Error(
						`Port ${fixedPort} is already in use. Please close other applications using this port.`
					)
				);
				return;
			}
			reject(err);
		});
	});
}

/**
 * Start a local HTTP server to receive OAuth callback
 */
export function startLocalServer(
	onCallback: (params: Record<string, string>) => void,
	fixedPort: number | null = null
): Promise<LocalServerHandle> {
	if (isBunRuntime) {
		return Promise.resolve(startLocalServerWithBun(onCallback, fixedPort));
	}
	return startLocalServerWithNode(onCallback, fixedPort);
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
