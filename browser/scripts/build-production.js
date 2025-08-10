#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root_dir = path.resolve(__dirname, '..');

function ensure_directory(dir_path) {
  if (!fs.existsSync(dir_path)) {
    fs.mkdirSync(dir_path, { recursive: true });
  }
}

function build_extension() {
  console.log('🔨 Building browser extension for production...');
  
  // Clean dist directory
  const dist_dir = path.join(root_dir, 'dist');
  if (fs.existsSync(dist_dir)) {
    fs.rmSync(dist_dir, { recursive: true });
  }
  ensure_directory(dist_dir);
  
  // Build with minification
  console.log('📦 Bundling content script...');
  execSync(
    `npx esbuild src/content.ts --bundle --outfile=dist/content.bundle.js --format=iife --minify --sourcemap=external`,
    { cwd: root_dir, stdio: 'inherit' }
  );
  
  console.log('📦 Bundling background script...');
  execSync(
    `npx esbuild src/background.ts --bundle --outfile=dist/background.bundle.js --format=esm --minify --sourcemap=external`,
    { cwd: root_dir, stdio: 'inherit' }
  );
  
  console.log('✅ Build complete');
}

function copy_to_browser_folders() {
  console.log('📁 Copying dist to browser folders...');
  
  const browsers = ['chrome', 'firefox'];
  
  for (const browser of browsers) {
    const browser_dist = path.join(root_dir, browser, 'dist');
    ensure_directory(browser_dist);
    
    // Copy built files
    const dist_files = fs.readdirSync(path.join(root_dir, 'dist'));
    for (const file of dist_files) {
      const src = path.join(root_dir, 'dist', file);
      const dest = path.join(browser_dist, file);
      fs.copyFileSync(src, dest);
    }
    
    console.log(`✅ Copied to ${browser}/dist`);
  }
}

async function create_zip(browser_name, output_dir) {
  const browser_dir = path.join(root_dir, browser_name);
  const output_file = path.join(output_dir, `${browser_name}-extension.zip`);
  
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(output_file);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => {
      console.log(`✅ Created ${browser_name}-extension.zip (${archive.pointer()} bytes)`);
      resolve(output_file);
    });
    
    archive.on('error', (err) => {
      reject(err);
    });
    
    archive.pipe(output);
    
    // Add manifest.json
    archive.file(path.join(browser_dir, 'manifest.json'), { name: 'manifest.json' });
    
    // Add dist folder
    archive.directory(path.join(browser_dir, 'dist'), 'dist');
    
    archive.finalize();
  });
}

async function package_extensions() {
  console.log('📦 Packaging browser extensions...');
  
  const builds_dir = path.join(root_dir, 'builds');
  ensure_directory(builds_dir);
  
  // Get version from package.json
  const package_json = JSON.parse(fs.readFileSync(path.join(root_dir, 'package.json'), 'utf8'));
  const version = package_json.version;
  
  const version_dir = path.join(builds_dir, `v${version}`);
  ensure_directory(version_dir);
  
  // Create zips for each browser
  await create_zip('chrome', version_dir);
  await create_zip('firefox', version_dir);
  
  // Create a copy for Edge (uses Chrome package)
  const chrome_zip = path.join(version_dir, 'chrome-extension.zip');
  const edge_zip = path.join(version_dir, 'edge-extension.zip');
  fs.copyFileSync(chrome_zip, edge_zip);
  console.log('✅ Created edge-extension.zip (copy of Chrome package)');
  
  console.log(`\n🎉 All extensions packaged in: ${version_dir}`);
  return version_dir;
}

// Main execution
async function main() {
  try {
    // Build the extension
    build_extension();
    
    // Copy to browser folders
    copy_to_browser_folders();
    
    // Package extensions
    const output_dir = await package_extensions();
    
    console.log('\n✨ Production build complete!');
    console.log(`📁 Build artifacts: ${output_dir}`);
    
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

// Check if archiver is installed
try {
  await import('archiver');
} catch {
  console.log('📦 Installing required dependency: archiver');
  execSync('npm install --save-dev archiver', { cwd: root_dir, stdio: 'inherit' });
}

main();