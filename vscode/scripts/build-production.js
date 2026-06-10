#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ENTRYPOINTS, SHIPPED_EXTERNALS } from './bundle_manifest.mjs';

/**
 * vsce target for the build host. The staged @duckdb binding (and any
 * fsevents) is the host's platform, so every VSIX is platform-targeted —
 * an untargeted package would install anywhere and die at require time.
 */
const VSCE_TARGETS = {
  'darwin-x64': 'darwin-x64',
  'darwin-arm64': 'darwin-arm64',
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
  'win32-x64': 'win32-x64',
  'win32-arm64': 'win32-arm64',
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root_dir = path.resolve(__dirname, '..');

/**
 * VS Code Extension Production Build Script
 * 
 * This script handles production builds for the VS Code extension,
 * including compilation, packaging, and artifact generation.
 */

class VSCodeExtensionBuilder {
  constructor() {
    this.package_json_path = path.join(root_dir, 'package.json');
    this.package_json = JSON.parse(fs.readFileSync(this.package_json_path, 'utf8'));
    this.version = this.package_json.version;
    this.name = this.package_json.name;
  }
  
  ensure_directory(dir_path) {
    if (!fs.existsSync(dir_path)) {
      fs.mkdirSync(dir_path, { recursive: true });
    }
  }
  
  clean_build() {
    console.log('🧹 Cleaning previous builds...');
    const out_dir = path.join(root_dir, 'out');
    const vsix_files = fs.readdirSync(root_dir).filter(f => f.endsWith('.vsix'));
    
    if (fs.existsSync(out_dir)) {
      fs.rmSync(out_dir, { recursive: true });
    }
    fs.rmSync(path.join(root_dir, 'builds', 'staging'), {
      recursive: true,
      force: true,
    });
    
    vsix_files.forEach(file => {
      fs.unlinkSync(path.join(root_dir, file));
    });
    
    console.log('✅ Cleaned build artifacts');
  }
  
  compile_typescript() {
    console.log('📦 Compiling TypeScript...');
    try {
      execSync('npm run compile', { 
        cwd: root_dir, 
        stdio: 'inherit' 
      });
      console.log('✅ TypeScript compilation complete');
    } catch (error) {
      console.error('❌ TypeScript compilation failed');
      throw error;
    }
  }

  bundle_entrypoints() {
    console.log('📦 Bundling runtime entrypoints (esbuild)...');
    execSync('node scripts/bundle.mjs', { cwd: root_dir, stdio: 'inherit' });
    execSync('node scripts/check-bundle-externals.mjs', {
      cwd: root_dir,
      stdio: 'inherit',
    });
    console.log('✅ Entrypoints bundled');
  }

  /**
   * Builds a clean staging directory for vsce: the bundled out/, the package
   * manifest with its dependencies trimmed to the unbundleable runtime
   * externals, and a node_modules containing exactly those packages. vsce
   * packages whatever is physically present in the staged node_modules (the
   * dev workspace's node_modules is hoisted and full of dev-only packages,
   * so packaging in place is non-deterministic). See
   * docs/decisions/native-dep-packaging.md.
   */
  stage_package_dir() {
    console.log('📦 Staging clean package directory...');
    const workspace_root = path.resolve(root_dir, '..');
    const staging_dir = path.join(root_dir, 'builds', 'staging');
    fs.rmSync(staging_dir, { recursive: true, force: true });
    fs.mkdirSync(staging_dir, { recursive: true });

    // Exactly the bundled entrypoints — the tsc module tree is the dev/test
    // layout and cannot even run in the package (its deps were inlined into
    // the bundles, not staged). server_standalone ships as the in-package
    // verification harness (see docs/decisions/native-dep-packaging.md).
    for (const { out } of ENTRYPOINTS) {
      const target = path.join(staging_dir, out);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root_dir, out), target);
    }

    for (const file of ['README.md', 'LICENSE', 'LICENSE.txt', 'CHANGELOG.md']) {
      const source = path.join(root_dir, file);
      if (fs.existsSync(source)) {
        fs.copyFileSync(source, path.join(staging_dir, file));
      }
    }

    // The manifest's runtime dependencies are exactly the externals the
    // bundle leaves unresolved; everything else was inlined by esbuild.
    // Scripts are dropped so vsce does not re-run vscode:prepublish.
    const manifest = { ...this.package_json };
    manifest.dependencies = Object.fromEntries(
      SHIPPED_EXTERNALS.map((pkg) => [pkg, this.package_json.dependencies[pkg]])
    );
    delete manifest.devDependencies;
    delete manifest.scripts;
    fs.writeFileSync(
      path.join(staging_dir, 'package.json'),
      JSON.stringify(manifest, null, 2)
    );
    fs.writeFileSync(
      path.join(staging_dir, '.vscodeignore'),
      ['**/*.map', '**/*.ts', ''].join('\n')
    );

    // The runtime externals plus their full transitive dependency closure
    // (npm physically places packages in either the workspace member or the
    // hoisted root; optional dependencies — the per-platform duckdb bindings
    // — are staged only when present, i.e. the build host's platform).
    const resolve_module = (pkg) => {
      const local = path.join(root_dir, 'node_modules', pkg);
      if (fs.existsSync(local)) return local;
      const hoisted = path.join(workspace_root, 'node_modules', pkg);
      if (fs.existsSync(hoisted)) return hoisted;
      return null;
    };
    const staged = new Set();
    const stage_with_dependencies = (pkg, optional) => {
      if (staged.has(pkg)) return;
      const source = resolve_module(pkg);
      if (!source) {
        if (optional) return;
        throw new Error(`Runtime external ${pkg} not found — run npm install`);
      }
      staged.add(pkg);
      fs.cpSync(source, path.join(staging_dir, 'node_modules', pkg), {
        recursive: true,
        dereference: true,
      });
      console.log(`  staged ${pkg}`);
      const manifest_path = path.join(source, 'package.json');
      const pkg_manifest = JSON.parse(fs.readFileSync(manifest_path, 'utf8'));
      for (const [dep, is_optional] of [
        ...Object.keys(pkg_manifest.dependencies ?? {}).map((d) => [d, false]),
        ...Object.keys(pkg_manifest.optionalDependencies ?? {}).map((d) => [d, true]),
      ]) {
        // A copy nested inside the parent (copied wholesale above) already
        // satisfies node resolution — staging a top-level duplicate would
        // ship a second, possibly different, version.
        if (fs.existsSync(path.join(source, 'node_modules', dep))) continue;
        stage_with_dependencies(dep, is_optional);
      }
    };
    for (const pkg of SHIPPED_EXTERNALS) {
      stage_with_dependencies(pkg, false);
    }

    console.log('✅ Staging directory ready');
    return staging_dir;
  }
  
  run_tests() {
    console.log('🧪 Running tests...');
    execSync('npm test', { 
      cwd: root_dir, 
      stdio: 'inherit',
      env: { ...process.env, CI: 'true' }
    });
    console.log('✅ All tests passed');
  }
  
  run_linter() {
    console.log('🔍 Running linter...');
    execSync('npm run lint', { 
      cwd: root_dir, 
      stdio: 'inherit' 
    });
    console.log('✅ Linting passed');
  }
  
  ensure_vsce() {
    try {
      execSync('npx vsce --version', { stdio: 'ignore' });
    } catch {
      console.log('📦 Installing vsce...');
      execSync('npm install -D @vscode/vsce', { 
        cwd: root_dir, 
        stdio: 'inherit' 
      });
    }
  }
  
  package_extension(staging_dir) {
    console.log('📦 Packaging VS Code extension...');
    
    this.ensure_vsce();
    
    const target = VSCE_TARGETS[`${process.platform}-${process.arch}`];
    if (!target) {
      throw new Error(
        `No vsce target mapping for ${process.platform}-${process.arch}`
      );
    }
    // Cross-compilation is impossible with host-resolved staging: the staged
    // duckdb binding must be the target's.
    const staged_binding = path.join(
      staging_dir,
      'node_modules',
      '@duckdb',
      `node-bindings-${target}`
    );
    if (!fs.existsSync(staged_binding)) {
      throw new Error(
        `Staged @duckdb binding does not match target ${target} — build on the target platform`
      );
    }
    
    // Create builds directory
    const builds_dir = path.join(root_dir, 'builds');
    const version_dir = path.join(builds_dir, `v${this.version}`);
    this.ensure_directory(version_dir);
    
    // Package the extension
    const vsix_name = `${this.name}-${this.version}-${target}.vsix`;
    const vsix_path = path.join(version_dir, vsix_name);
    
    try {
      // Packaged from the staging dir: vsce ships exactly the staged
      // node_modules (the runtime externals), targeted at the build host's
      // platform.
      execSync(`npx vsce package --target ${target} --out "${vsix_path}"`, { 
        cwd: staging_dir, 
        stdio: 'inherit' 
      });
      
      console.log(`✅ Extension packaged: ${vsix_name}`);
      
      // Create a copy in the root for easy access
      const root_vsix = path.join(root_dir, vsix_name);
      fs.copyFileSync(vsix_path, root_vsix);
      
      return {
        vsix_path,
        vsix_name,
        version: this.version
      };
    } catch (error) {
      console.error('❌ Packaging failed');
      throw error;
    }
  }
  
  validate_package(vsix_path) {
    console.log('✓ Validating package...');
    
    // Check file size
    const stats = fs.statSync(vsix_path);
    const size_mb = stats.size / (1024 * 1024);
    console.log(`  Package size: ${size_mb.toFixed(2)} MB`);
    
    if (size_mb > 100) {
      console.warn('⚠️  Package size exceeds 100MB, may have issues publishing');
    }
    
    // Verify it's a valid zip file (VSIX is a zip)
    try {
      execSync(`unzip -t "${vsix_path}" > /dev/null 2>&1`, { stdio: 'ignore' });
      console.log('  ✅ Package structure valid');
    } catch {
      throw new Error('Invalid VSIX package structure');
    }
  }
  
  generate_metadata(package_info) {
    const metadata = {
      name: this.name,
      version: this.version,
      timestamp: new Date().toISOString(),
      vsix_file: package_info.vsix_name,
      sha256: this.calculate_sha256(package_info.vsix_path),
      size: fs.statSync(package_info.vsix_path).size
    };
    
    const metadata_path = path.join(
      path.dirname(package_info.vsix_path), 
      'metadata.json'
    );
    
    fs.writeFileSync(
      metadata_path, 
      JSON.stringify(metadata, null, 2)
    );
    
    console.log('✅ Generated metadata.json');
    return metadata;
  }
  
  calculate_sha256(file_path) {
    try {
      const output = execSync(`shasum -a 256 "${file_path}"`, { 
        encoding: 'utf8' 
      });
      return output.split(' ')[0];
    } catch {
      return 'unavailable';
    }
  }
  
  async build() {
    console.log(`🚀 Building ${this.name} v${this.version} for production\n`);
    
    try {
      // Clean previous builds
      this.clean_build();
      
      // Run pre-build checks
      this.run_linter();
      this.run_tests();
      
      // Compile TypeScript
      this.compile_typescript();
      
      // Bundle entrypoints and stage the clean package directory
      this.bundle_entrypoints();
      const staging_dir = this.stage_package_dir();
      
      // Package extension
      const package_info = this.package_extension(staging_dir);
      
      // Validate package
      this.validate_package(package_info.vsix_path);
      
      // Generate metadata
      const metadata = this.generate_metadata(package_info);
      
      console.log('\n✨ Production build complete!');
      console.log(`📁 Output: ${package_info.vsix_path}`);
      console.log(`📊 Size: ${(metadata.size / 1024 / 1024).toFixed(2)} MB`);
      console.log(`🔒 SHA256: ${metadata.sha256}`);
      
      return package_info;
      
    } catch (error) {
      console.error('\n❌ Build failed:', error.message);
      process.exit(1);
    }
  }
}

// Main execution
async function main() {
  const builder = new VSCodeExtensionBuilder();
  await builder.build();
}

// Check for help flag
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
VS Code Extension Production Build Script

Usage:
  node scripts/build-production.js

This script will:
- Clean previous build artifacts
- Run linting and tests
- Compile TypeScript
- Package the extension as VSIX
- Validate the package
- Generate metadata

Output:
- builds/v{version}/{name}-{version}.vsix
- builds/v{version}/metadata.json
  `);
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});