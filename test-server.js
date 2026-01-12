const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8765;

const server = http.createServer((req, res) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);

    // Parse URL and query parameters
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // Route: /auth-callback (the callback endpoint)
    if (url.pathname === "/auth-callback") {
        // Serve the test callback page
        const filePath = path.join(__dirname, "test-callback.html");
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(500, { "Content-Type": "text/plain" });
                res.end("Error loading callback page");
                return;
            }
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(data);
        });

        // Log received parameters
        const params = {
            uid: url.searchParams.get("uid"),
            name: url.searchParams.get("name"),
            email: url.searchParams.get("email"),
            photo_url: url.searchParams.get("photo_url"),
            tier: url.searchParams.get("tier"),
        };
        console.log("\n✅ Received callback with user info:");
        console.log(JSON.stringify(params, null, 2));
        console.log("\n");
    }
    // Route: / (homepage)
    else if (url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Test Server - localhost:${PORT}</title>
                <style>
                    body {
                        font-family: system-ui, sans-serif;
                        max-width: 600px;
                        margin: 50px auto;
                        padding: 20px;
                        background: #f5f5f5;
                    }
                    .container {
                        background: white;
                        padding: 30px;
                        border-radius: 12px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                    }
                    a {
                        display: inline-block;
                        margin: 10px 0;
                        padding: 12px 24px;
                        background: #0070f3;
                        color: white;
                        text-decoration: none;
                        border-radius: 6px;
                    }
                    a:hover { background: #0051cc; }
                    code {
                        background: #f0f0f0;
                        padding: 2px 6px;
                        border-radius: 3px;
                        font-size: 14px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🧪 Test Server Running</h1>
                    <p>Server is running on <code>localhost:${PORT}</code></p>
                    
                    <h2>Test the Login Callback:</h2>
                    <ol>
                        <li>Make sure your Next.js app is running on <code>localhost:3000</code></li>
                        <li>Click the button below to test the login flow:</li>
                    </ol>
                    
                    <a href="http://localhost:3000/login?redirect_uri=http://localhost:${PORT}/auth-callback">
                        Test Login with Callback
                    </a>
                    
                    <p style="color: #666; margin-top: 20px;">
                        After logging in, you'll be redirected back to 
                        <code>/auth-callback</code> with user info.
                    </p>
                    
                    <h3>Endpoints:</h3>
                    <ul>
                        <li><code>/</code> - This page</li>
                        <li><code>/auth-callback</code> - Callback handler page</li>
                    </ul>
                </div>
            </body>
            </html>
        `);
    }
    // 404 for other routes
    else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 - Not Found");
    }
});

server.listen(PORT, () => {
    console.log(`\n🚀 Test server running at http://localhost:${PORT}/`);
    console.log(`📍 Callback endpoint: http://localhost:${PORT}/auth-callback`);
    console.log(`\n💡 To test the login callback:`);
    console.log(
        `   1. Make sure your Next.js app is running on localhost:3000`
    );
    console.log(`   2. Open http://localhost:${PORT}/ in your browser`);
    console.log(`   3. Click the test button to go through the login flow\n`);
});
