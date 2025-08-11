#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root_dir = path.resolve(__dirname, '..');

/**
 * VS Code Extension Version Management Script
 * 
 * Handles version bumping and changelog generation for the VS Code extension.
 * Follows semantic versioning principles.
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
      case 'prerelease':
        // Handle pre-release versions (e.g., 1.0.0-beta.1)
        const pre_match = this.current_version.match(/(\d+\.\d+\.\d+)-(\w+)\.(\d+)/);
        if (pre_match) {
          const pre_num = parseInt(pre_match[3]) + 1;
          return `${pre_match[1]}-${pre_match[2]}.${pre_num}`;
        } else {
          return `${v.major}.${v.minor}.${v.patch}-beta.1`;
        }
      default:
        throw new Error(`Invalid version bump type: ${type}`);
    }
    
    return `${v.major}.${v.minor}.${v.patch}`;
  }
  
  get_git_commits(from_tag) {
    try {
      let command;
      if (from_tag) {
        command = `git log ${from_tag}..HEAD --pretty=format:"%h %s" --no-merges`;
      } else {
        command = `git log --pretty=format:"%h %s" --no-merges -n 30`;
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
      breaking: [],
      features: [],
      fixes: [],
      performance: [],
      docs: [],
      refactor: [],
      test: [],
      chore: [],
      other: []
    };
    
    for (const commit of commits) {
      const lower = commit.toLowerCase();
      const message = commit.substring(8); // Skip the hash
      
      // Check for breaking changes
      if (lower.includes('breaking change') || lower.includes('breaking:')) {
        categories.breaking.push(commit);
      }
      // Check for conventional commit types
      else if (lower.match(/^[a-f0-9]{7} feat(\(.+\))?:/)) {
        categories.features.push(commit);
      } else if (lower.match(/^[a-f0-9]{7} fix(\(.+\))?:/)) {
        categories.fixes.push(commit);
      } else if (lower.match(/^[a-f0-9]{7} perf(\(.+\))?:/)) {
        categories.performance.push(commit);
      } else if (lower.match(/^[a-f0-9]{7} docs(\(.+\))?:/)) {
        categories.docs.push(commit);
      } else if (lower.match(/^[a-f0-9]{7} refactor(\(.+\))?:/)) {
        categories.refactor.push(commit);
      } else if (lower.match(/^[a-f0-9]{7} test(\(.+\))?:/)) {
        categories.test.push(commit);
      } else if (lower.match(/^[a-f0-9]{7} chore(\(.+\))?:/)) {
        categories.chore.push(commit);
      }
      // Fallback pattern matching
      else if (lower.includes('add') || lower.includes('implement') || lower.includes('create')) {
        categories.features.push(commit);
      } else if (lower.includes('fix') || lower.includes('bug') || lower.includes('resolve')) {
        categories.fixes.push(commit);
      } else if (lower.includes('doc') || lower.includes('readme')) {
        categories.docs.push(commit);
      } else if (lower.includes('refactor') || lower.includes('clean')) {
        categories.refactor.push(commit);
      } else if (lower.includes('test') || lower.includes('spec')) {
        categories.test.push(commit);
      } else if (lower.includes('chore') || lower.includes('deps') || lower.includes('build')) {
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
    
    if (categories.breaking.length > 0) {
      entry += '### ⚠️ BREAKING CHANGES\n';
      categories.breaking.forEach(c => entry += `- ${c}\n`);
      entry += '\n';
    }
    
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
    
    if (categories.performance.length > 0) {
      entry += '### ⚡ Performance Improvements\n';
      categories.performance.forEach(c => entry += `- ${c}\n`);
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
    // Get last tag for VS Code extension
    let last_tag;
    try {
      // Look for vscode-specific tags first
      last_tag = execSync('git describe --tags --match "vscode-v*" --abbrev=0 2>/dev/null', { cwd: root_dir })
        .toString()
        .trim();
    } catch {
      try {
        // Fall back to any tag
        last_tag = execSync('git describe --tags --abbrev=0', { cwd: root_dir })
          .toString()
          .trim();
      } catch {
        last_tag = null;
      }
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
      changelog = `# Changelog

All notable changes to the PKM Assistant VS Code Extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`;
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
    
    // Update changelog
    this.update_changelog(new_version);
    
    // Check if we're in a git repo
    try {
      execSync('git status', { cwd: root_dir, stdio: 'ignore' });
      
      console.log('\n📝 Git commands to commit and tag:');
      console.log(`  cd vscode`);
      console.log(`  git add -A`);
      console.log(`  git commit -m "chore(vscode): bump version to ${new_version}"`);
      console.log(`  git tag vscode-v${new_version}`);
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
  
  if (!['major', 'minor', 'patch', 'prerelease'].includes(type)) {
    console.error(`❌ Invalid version type: ${type}`);
    console.error('Use: major, minor, patch, or prerelease');
    process.exit(1);
  }
  
  const manager = new VersionManager();
  await manager.bump(type);
}

// Check for help flag
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
VS Code Extension Version Management Tool

Usage:
  node scripts/version-bump.js [type]

Options:
  [type]        Version bump type: major, minor, patch, or prerelease (default: patch)
  --help, -h    Show this help message

Examples:
  npm run version:patch      # 1.0.0 -> 1.0.1
  npm run version:minor      # 1.0.0 -> 1.1.0
  npm run version:major      # 1.0.0 -> 2.0.0
  npm run version:prerelease # 1.0.0 -> 1.0.0-beta.1

This tool will:
- Update package.json version
- Generate/update CHANGELOG.md with recent commits
- Suggest git commands for committing and tagging
  `);
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});