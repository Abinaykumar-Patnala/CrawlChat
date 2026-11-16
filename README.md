# CrawlChat

BuildSprint Round 2 prototype. A browser chat translates natural-language website tasks into a controlled Python CLI crawl and returns an extractive summary with JSON and process diagnostics.

## Run locally

Install Node.js 20+ and Python 3.10+. Open the extracted CrawlChat folder in a terminal and run:

```sh
node server.mjs
```

Open http://127.0.0.1:3000. Ports 3000 and 8765 must be available. The app uses only standard libraries. Set PYTHON to your Python executable if the OS default differs.

Click **Use demo prompt**, then **Run crawl**. The crawler makes real HTTP requests to a bundled, three-page website served on port 8765. Expand **Structured JSON** to see page URLs, titles, text excerpts, links and execution diagnostics. You can also ask to crawl https://example.com, subject to outbound network access and the site's robots policy.

## Enable OpenAI intent interpretation

Configure OPENAI_API_KEY in your terminal environment, optionally set OPENAI_MODEL (defaults to gpt-4o-mini), then start the server. Never include the key in the repository or recording. The chat's execution row shows which intent interpreter ran. With no key or an API failure, a local rule-based interpreter handles common crawl requests. Crawl extraction and summary generation use the actual CLI result in either mode. Codex assisted with implementation.

## Flow and limits

Browser → Node.js HTTP API → intent and validated crawl plan → execFile → Python crawler → JSON over stdout → Node.js summary → browser.

The backend launches a fixed Python script with separate arguments and shell execution disabled. It handles one active request, limits the CLI to 16 seconds and caps captured output. Cancel aborts the browser request and the backend terminates the child on disconnect. The Python worker checks robots.txt, rejects redirects, follows only same-origin links on two approved origins and attempts at most five pages. Each response is limited to 256 KB. Website text is treated as data and displayed as text. The CLI environment excludes the OpenAI key. This prototype is bound to loopback.

## Verify and record

Run the three-page demo and open the JSON. Show the actual child PID, exit code and stdout byte count. Then ask to crawl http://127.0.0.1:8765/missing to demonstrate a captured 404, or ask to crawl https://unapproved.invalid to demonstrate input rejection.

For the required 4–7 minute video, introduce the problem, show the architecture, demonstrate a live chat crawl, open the JSON, explain the process diagnostics, then show an error and explain the controls. Mention the stack and actual AI mode used. Upload one video and submit its accessible link in the official form.
