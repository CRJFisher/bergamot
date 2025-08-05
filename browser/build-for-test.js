#!/usr/bin/env node

import { createServer } from 'net';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

// Function to find a free port
function findFreePort() {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.listen(0, (err) => {
            if (err) {
                reject(err);
            } else {
                const port = server.address().port;
                server.close(() => {
                    resolve(port);
                });
            }
        });
    });
}

async function buildWithMockPort() {
    try {
        // Find a free port
        const mockPort = await findFreePort();
        console.log(`📡 Found free port for mock server: ${mockPort}`);

        // Write the port to a file that tests can read
        writeFileSync('test-port.txt', mockPort.toString());
        console.log(`💾 Saved port ${mockPort} to test-port.txt`);

        // Build the extension with the mock port injected
        // Note: We're using JSON.stringify to properly escape the port value
        const portDefine = `MOCK_PKM_PORT=${JSON.stringify(mockPort.toString())}`;
        const buildCommand = `esbuild src/content.ts --bundle --outfile=dist/content.bundle.js --format=iife --allow-overwrite --define:${portDefine} && esbuild src/background.ts --bundle --outfile=dist/background.bundle.js --format=esm --allow-overwrite --define:${portDefine}`;

        console.log(`🔨 Building extension with mock port ${mockPort}...`);
        execSync(buildCommand, { stdio: 'inherit' });

        console.log(`✅ Extension built successfully with mock port ${mockPort}`);

    } catch (error) {
        console.error('❌ Build failed:', error);
        process.exit(1);
    }
}

buildWithMockPort(); 