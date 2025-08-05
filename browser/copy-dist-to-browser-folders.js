#!/usr/bin/env node

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distPath = path.resolve(__dirname, 'dist');
const targets = ['chrome', 'firefox'];

for (const target of targets) {
    const targetPath = path.resolve(__dirname, target, 'dist');
    try {
        // Remove existing dist folder if it exists
        if (await fs.access(targetPath).then(() => true).catch(() => false)) {
            await fs.rm(targetPath, { recursive: true, force: true });
        }
        // Copy the dist folder
        await copyFolderRecursiveSync(distPath, targetPath);
        console.log(`Copied dist to ${target}/dist`);
    } catch (err) {
        console.error(`Failed to copy dist to ${target}/dist:`, err);
    }
}

async function copyFolderRecursiveSync(source, target) {
    if (!(await fs.access(target).then(() => true).catch(() => false))) {
        await fs.mkdir(target, { recursive: true });
    }
    for (const file of await fs.readdir(source)) {
        const srcFile = path.join(source, file);
        const tgtFile = path.join(target, file);
        if ((await fs.lstat(srcFile)).isDirectory()) {
            await copyFolderRecursiveSync(srcFile, tgtFile);
        } else {
            await fs.copyFile(srcFile, tgtFile);
        }
    }
} 