# Contributing to PKM Assistant

Thank you for your interest in contributing to PKM Assistant! This guide will help you get started.

## Code of Conduct

Please be respectful and constructive in all interactions. We're building a welcoming community.

## Getting Started

1. **Fork and Clone**
   ```bash
   git clone https://github.com/your-username/pkm-assistant.git
   cd pkm-assistant
   npm install
   ```

2. **Build Everything**
   ```bash
   npm run build
   ```

3. **Run Tests**
   ```bash
   npm test
   ```

## Development Workflow

### Working on the VS Code Extension

```bash
cd packages/vscode
npm run watch  # Compile in watch mode
```

To test:
1. Open VS Code
2. Run "Launch Extension" from the debug panel (F5)
3. Test in the new VS Code window

### Working on the Browser Extension

```bash
cd packages/browser
npm run watch  # Build in watch mode
npm run chrome:debug  # Launch Chrome with extension
```

## Making Changes

### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
```

### 2. Make Your Changes

- Follow the existing code style
- Add tests for new functionality
- Update documentation as needed

### 3. Commit Your Changes

We use conventional commits:

```bash
git commit -m "feat: add new feature"
git commit -m "fix: resolve issue with..."
git commit -m "docs: update README"
```

### 4. Create a Changeset

```bash
npm run changeset
```

Follow the prompts to describe your changes.

### 5. Submit a Pull Request

- Push your branch to your fork
- Create a PR against the main branch
- Fill out the PR template
- Wait for review

## Code Style

- **TypeScript**: Use snake_case for variables and functions
- **Classes**: PascalCase for class names
- **Files**: snake_case for file names
- **Functional style preferred**: Avoid stateful classes

## Testing

### Unit Tests

```bash
# Run all tests
npm test

# Run tests for specific package
npm test -w @pkm-assistant/vscode
```

### E2E Tests (Browser Extension)

```bash
cd packages/browser
npm run test:cdp
```

## Documentation

- Update README.md for user-facing changes
- Add JSDoc comments for public APIs
- Update backlog docs for architectural changes

## Debugging Tips

### VS Code Extension

1. Use the VS Code debugger (F5)
2. Check Output > PKM Assistant for logs
3. Use Developer Tools (Help > Toggle Developer Tools)

### Browser Extension

1. Check service worker console in chrome://extensions
2. Use regular DevTools for content scripts
3. Enable verbose logging with `--verbose` flag

## Common Issues

### Build Failures

```bash
# Clean and rebuild
npm run clean
npm install
npm run build
```

### Type Errors

- Check `tsconfig.json` settings
- Run `npm run lint` to identify issues

## Questions?

- Check existing issues first
- Ask in discussions for general questions
- Create an issue for bugs or feature requests

## License

By contributing, you agree that your contributions will be licensed under the MIT License.