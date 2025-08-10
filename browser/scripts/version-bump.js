#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root_dir = path.resolve(__dirname, '..');

/**
 * Version Bump and Changelog Generation Script
 * 
 * This script handles version bumping and changelog generation for releases.
 * 
 * Usage:
 *   npm run version:patch   - Bump patch version (1.0.0 -> 1.0.1)
 *   npm run version:minor   - Bump minor version (1.0.0 -> 1.1.0)
 *   npm run version:major   - Bump major version (1.0.0 -> 2.0.0)
 */

class VersionManager {
  constructor() {
    this.package_path = path.join(root_dir, 'package.json');
    this.changelog_path = path.join(root_dir, 'CHANGELOG.md');
    this.package_json = JSON.parse(fs.readFileSync(this.package_path, 'utf8'));
    this.current_version = this.package_json.version;
  }
  
  parse_version(version) {
    const parts = version.split('.');
    return {
      major: parseInt(parts[0]),
      minor: parseInt(parts[1]),
      patch: parseInt(parts[2])
    };
  }
  
  bump_version(type) {
    const v = this.parse_version(this.current_version);
    
    switch (type) {
      case 'major':
        v.major += 1;
        v.minor = 0;
        v.patch = 0;
        break;
      case 'minor':
        v.minor += 1;
        v.patch = 0;
        break;
      case 'patch':
        v.patch += 1;
        break;
      default:
        throw new Error(`Invalid version bump type: ${type}`);
    }
    
    return `${v.major}.${v.minor}.${v.patch}`;
  }
  
  update_manifest(browser, version) {
    const manifest_path = path.join(root_dir, browser, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifest_path, 'utf8'));
    manifest.version = version;
    fs.writeFileSync(manifest_path, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`✅ Updated ${browser}/manifest.json to version ${version}`);
  }
  
  get_git_commits(from_tag) {
    try {
      let command;
      if (from_tag) {
        command = `git log ${from_tag}..HEAD --pretty=format:"%s (%h)" --no-merges`;
      } else {
        command = `git log --pretty=format:"%s (%h)" --no-merges -n 20`;
      }
      
      const commits = execSync(command, { cwd: root_dir })
        .toString()
        .trim()
        .split('\n')
        .filter(line => line.length > 0);
      
      return commits;
    } catch {
      return [];
    }
  }
  
  categorize_commits(commits) {
    const categories = {
      features: [],
      fixes: [],
      docs: [],
      refactor: [],
      test: [],
      chore: [],
      other: []
    };
    
    for (const commit of commits) {
      const lower = commit.toLowerCase();
      
      if (lower.startsWith('feat:') || lower.startsWith('feature:') || lower.includes('add')) {
        categories.features.push(commit);
      } else if (lower.startsWith('fix:') || lower.includes('fix')) {
        categories.fixes.push(commit);
      } else if (lower.startsWith('docs:') || lower.includes('document')) {
        categories.docs.push(commit);
      } else if (lower.startsWith('refactor:') || lower.includes('refactor')) {
        categories.refactor.push(commit);
      } else if (lower.startsWith('test:') || lower.includes('test')) {
        categories.test.push(commit);
      } else if (lower.startsWith('chore:') || lower.includes('chore')) {
        categories.chore.push(commit);
      } else {
        categories.other.push(commit);
      }
    }
    
    return categories;
  }
  
  generate_changelog_entry(version, commits) {
    const date = new Date().toISOString().split('T')[0];
    const categories = this.categorize_commits(commits);
    
    let entry = `## [${version}] - ${date}\n\n`;
    
    if (categories.features.length > 0) {
      entry += '### ✨ Features\n';
      categories.features.forEach(c => entry += `- ${c}\n`);
      entry += '\n';
    }
    
    if (categories.fixes.length > 0) {
      entry += '### 🐛 Bug Fixes\n';
      categories.fixes.forEach(c => entry += `- ${c}\n`);
      entry += '\n';
    }
    
    if (categories.refactor.length > 0) {
      entry += '### ♻️ Refactoring\n';
      categories.refactor.forEach(c => entry += `- ${c}\n`);
      entry += '\n';
    }
    
    if (categories.docs.length > 0) {
      entry += '### 📚 Documentation\n';
      categories.docs.forEach(c => entry += `- ${c}\n`);
      entry += '\n';
    }
    
    if (categories.test.length > 0) {
      entry += '### 🧪 Tests\n';
      categories.test.forEach(c => entry += `- ${c}\n`);
      entry += '\n';
    }
    
    if (categories.chore.length > 0) {
      entry += '### 🔧 Chores\n';
      categories.chore.forEach(c => entry += `- ${c}\n`);
      entry += '\n';
    }
    
    if (categories.other.length > 0) {
      entry += '### 📦 Other Changes\n';
      categories.other.forEach(c => entry += `- ${c}\n`);
      entry += '\n';
    }
    
    return entry;
  }
  
  update_changelog(version) {
    // Get last tag
    let last_tag;
    try {
      last_tag = execSync('git describe --tags --abbrev=0', { cwd: root_dir })
        .toString()
        .trim();
    } catch {
      last_tag = null;
    }
    
    // Get commits since last tag
    const commits = this.get_git_commits(last_tag);
    
    if (commits.length === 0) {
      console.log('⚠️  No commits found for changelog');
      return;
    }
    
    // Generate changelog entry
    const new_entry = this.generate_changelog_entry(version, commits);
    
    // Read existing changelog or create new
    let changelog = '';
    if (fs.existsSync(this.changelog_path)) {
      changelog = fs.readFileSync(this.changelog_path, 'utf8');
    } else {
      changelog = '# Changelog\n\nAll notable changes to the PKM Assistant Browser Extension will be documented in this file.\n\n';
    }
    
    // Insert new entry after header
    const header_end = changelog.indexOf('\n\n') + 2;
    if (header_end > 1) {
      changelog = changelog.slice(0, header_end) + new_entry + '\n' + changelog.slice(header_end);
    } else {
      changelog += '\n\n' + new_entry;
    }
    
    // Write updated changelog
    fs.writeFileSync(this.changelog_path, changelog);
    console.log(`✅ Updated CHANGELOG.md with version ${version}`);
  }
  
  async bump(type) {
    const new_version = this.bump_version(type);
    
    console.log(`📦 Bumping version from ${this.current_version} to ${new_version}`);
    
    // Update package.json
    this.package_json.version = new_version;
    fs.writeFileSync(this.package_path, JSON.stringify(this.package_json, null, 2) + '\n');
    console.log(`✅ Updated package.json to version ${new_version}`);
    
    // Update manifest files
    this.update_manifest('chrome', new_version);
    this.update_manifest('firefox', new_version);
    
    // Update changelog
    this.update_changelog(new_version);
    
    // Check if we're in a git repo
    try {
      execSync('git status', { cwd: root_dir, stdio: 'ignore' });
      
      console.log('\n📝 Git commands to commit and tag:');
      console.log(`  git add -A`);
      console.log(`  git commit -m "chore: bump version to ${new_version}"`);
      console.log(`  git tag v${new_version}`);
      console.log(`  git push origin main --tags`);
      
    } catch {
      console.log('\n⚠️  Not in a git repository');
    }
    
    console.log(`\n✨ Version bumped to ${new_version}`);
    return new_version;
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const type = args[0] || 'patch';
  
  if (!['major', 'minor', 'patch'].includes(type)) {
    console.error(`❌ Invalid version type: ${type}`);
    console.error('Use: major, minor, or patch');
    process.exit(1);
  }
  
  const manager = new VersionManager();
  await manager.bump(type);
}

// Check for help flag
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Version Management Tool

Usage:
  node scripts/version-bump.js [type]

Options:
  [type]        Version bump type: major, minor, or patch (default: patch)
  --help, -h    Show this help message

Examples:
  npm run version:patch   # 1.0.0 -> 1.0.1
  npm run version:minor   # 1.0.0 -> 1.1.0  
  npm run version:major   # 1.0.0 -> 2.0.0

This tool will:
- Update package.json version
- Update manifest.json versions for Chrome and Firefox
- Generate/update CHANGELOG.md with recent commits
- Suggest git commands for committing and tagging
  `);
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});